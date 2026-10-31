# 调研：Figma 变量（variables）怎么用、我们怎么接

> 2026-10-29，`@figma/plugin-typings` 1.142.0，`@figma/rest-api-spec` 0.46.0，Node 26.12.1，macOS 27.0.1
> 起因：用户说「我们要整理一下 figma 的 variables 是怎么用的」。
> 这份文档回答三件事：Figma 的变量是怎么回事，我们导出的数据里有什么，在我们的画布里怎么接。用户定了方向以后，设计写进 [技术实现](tech.md)，步骤写进[施工计划](plan.md)。

## 1. 结论

**变量就是设计稿里"起了名字的值"，再加上"一套值可以有好几个版本"。** 比如建一个叫 `color/bg` 的颜色变量，亮色模式下是白色、暗色模式下是黑色，把 100 个 frame 的填充都绑到它上面。之后改 `color/bg` 的值，100 个 frame 一起变；把外层 frame 的模式从"亮色"切成"暗色"，里面所有绑定的图层一起换成暗色的值。颜色、数字、文字、开关四种值都能这样用（§3.1）。

**现在的画面不受变量影响，不用改画法。** 插件导出的每个属性值，Figma 已经按导出那一刻的模式算好了，变量只是在旁边多记了一个"这个值来自哪个变量"的引用（§3.6）。所以 175 个用例的还原度和变量无关。

**变量要在"编辑"的时候才有用**：改变量的值、切换模式、给属性绑或解绑变量，这些操作都要把所有受影响的图层重算一遍（§5）。这件事和组件里"改主组件、实例跟着变"是同一类工作。

**最大的缺口在数据：插件没导出变量本身，用例里也几乎没有变量。**

- 197 份快照、25.8 万个图层里，只有 2 个用例（Untitled UI 的设置页）的 8 个图层绑了变量，而且都只绑了圆角，变量来自外部库（§4.1）。
- 快照里只有引用 `{"type": "VARIABLE_ALIAS", "id": "VariableID:…"}`，变量叫什么、属于哪个集合、有几个模式、每个模式的值是多少，都没有（§4.3）。
- 插件 API 能读到这些（任何套餐都行）；REST API 的变量接口只有 Enterprise 能用。我们本来就用插件取数据，正好（§3.6）。

所以第一步是让插件生成一批用到变量的用例，同时把变量定义和模式导出来（§6）。

| Figma 的东西                   | 在我们这边怎么做                                                     | 难度 / 依赖 |
| ------------------------------ | -------------------------------------------------------------------- | ----------- |
| 属性上绑的变量                 | 已经在快照里（`boundVariables`），导入时原样留在 `node` 上           | 已有        |
| 变量、集合、模式的定义         | 插件导出到快照的新字段 `variables`，导入时放进文档级的一条记录       | 要先改插件  |
| 图层上设的模式                 | 插件导出每个图层显式设的模式，导出范围的根节点记上从祖先继承来的模式 | 要先改插件  |
| 按图层算出变量的值             | 新写 `figma/variables.ts`：沿父图层找模式，沿别名链取值              | 小          |
| 改变量值、切模式时图层跟着变   | 放进现有编辑引擎，和组件同步、自动布局重排同一时机，撤销一步回去     | 中          |
| 面板上显示和编辑               | 属性面板里绑了变量的字段显示变量名；frame 上加模式选择；单独的变量表 | 中          |
| 库变量                         | 只读；能不能拿到值要实测（§8）                                       | 要先实测    |
| 扩展集合、动画变量、原型表达式 | 以后再说                                                             | —           |

## 2. 怎么查的

- **查资料**：Figma 开发者文档（插件 API、REST API）和帮助中心，2026-10-29 读的。出处写在各节末尾。文档没写明、是推断出来的，标"未确认"。
- **核对类型**：下载了 Figma 官方的两个类型包，`@figma/plugin-typings` 1.142.0（插件 API）和 `@figma/rest-api-spec` 0.46.0（REST 和 `JSON_REST_V1` 导出的格式），对了 §3.3、§3.6 里的字段名。
- **数据统计**：`cases/` 下全部 197 份 `snapshot.json`（包括 `mains` 里的主组件），数 `boundVariables` 和 `explicitVariableModes`。
- **看代码**：`apps/figma-plugin/code.js`、`manifest.json`，`apps/client/src/figma/components.ts`、`editing/engine.ts`、`types.ts`。
- 统计脚本是一次性的，放在 scratchpad，没有进仓库。

## 3. Figma 的变量体系

### 3.1 几个概念

| 概念                            | 是什么                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 变量（variable）                | 一个有名字的值，比如 `color/bg`、`spacing/md`。名字里的 `/` 在变量面板里显示成分组                                                                                                             |
| 类型                            | `COLOR`（纯色，可带透明度）、`FLOAT`（数字）、`STRING`（文字）、`BOOLEAN`（开关）。2026-08 起还有 `EASING`、`TIMING`，只给 Figma 的动画用，和画面无关                                          |
| 集合（collection）              | 一组变量 + 一组模式。集合里每个变量对每个模式各存一个值。常见的集合：颜色主题、间距、圆角、字号                                                                                                |
| 模式（mode）                    | 同一套变量的一个版本，比如"亮色 / 暗色"、"手机 / 桌面"、"中文 / 英文"。每个集合有一个默认模式（变量面板最左边那一列）。模式个数有套餐上限：免费版 1 个，Professional 10 个，Organization 20 个 |
| 别名（alias）                   | 变量的值可以指向另一个变量，比如 `color/button/bg` 的值是 `color/brand/500`。只能指向同类型的变量，不能指向自己，不能成环。常用来分两层：底层是色板，上层是"按钮背景"这种语义名                |
| 作用范围（`scopes`）            | 控制变量出现在哪些属性的选择列表里，比如只给圆角用、只给文字颜色用。只影响界面，不影响用 API 绑定                                                                                              |
| 代码名（`codeSyntax`）          | 给 Dev Mode 用的名字，分 Web / Android / iOS 三种，比如 `var(--color-bg)`                                                                                                                      |
| 库变量（remote）                | 别的文件发布出来、这个文件订阅了的变量，`remote` 为 `true`，在这个文件里只读                                                                                                                   |
| 扩展集合（extended collection） | 只有 Enterprise 有：继承一个集合的全部变量和模式，只能改值，用来做多品牌                                                                                                                       |

出处：[变量概览](https://help.figma.com/hc/en-us/articles/14506821864087)、[`VariableCollection`](https://developers.figma.com/docs/plugins/api/VariableCollection/)、[`VariableScope`](https://developers.figma.com/docs/plugins/api/VariableScope/)、[`VariableResolvedDataType`](https://developers.figma.com/docs/plugins/api/VariableResolvedDataType/)、[套餐](https://help.figma.com/hc/en-us/articles/360040328273)、[扩展集合](https://help.figma.com/hc/en-us/articles/36346281624471)。

### 3.2 模式怎么落到图层上

**默认是"自动"：图层自己没设，就往上找父图层，一路找到 page；都没设，用集合的默认模式。** 能设模式的有 frame、组件、组件集、实例、section、group 和 page。

- 每个集合单独算。一个 frame 可以同时设"主题 = 暗色"和"密度 = 紧凑"。
- 一个图层只记自己显式设的那几个，字段是 `explicitVariableModes: { [集合 id]: 模式 id }`。插件 API 另外有 `resolvedVariableModes`，是自己加上所有祖先合起来的结果；REST 和 `JSON_REST_V1` 导出里只有前者，继承要自己沿父链算。
- Enterprise 等套餐可以给库设团队级的默认模式，新建文件时写到 page 上。`explicitVariableModes` 不包含这一层。
- 实例可以设和主组件不一样的模式，Figma 推荐用这个办法在一页里同时摆亮色和暗色的按钮。主组件上设的模式会不会带到实例上，文档没写明，未确认。
- 改了集合的默认模式：设成"自动"的图层跟着变，显式选了旧默认模式的图层不变。

出处：[模式](https://help.figma.com/hc/en-us/articles/15343816063383)、[`explicitVariableModes`](https://developers.figma.com/docs/plugins/api/node-properties/)、[`resolvedVariableModes`](https://developers.figma.com/docs/plugins/api/properties/nodes-resolvedvariablemodes/)、[团队默认模式](https://help.figma.com/hc/en-us/articles/21310245473815)。

### 3.3 能绑在哪些属性上

"导出 JSON 里的键"就是我们快照 `rest` 里出现的样子，和插件 API 的字段名有好几处不一样，写代码时要按左边这列对。

| 属性                                   | 变量类型                                            | 插件 API 的字段                                                              | 导出 JSON 里的键                                                                                                             |
| -------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 宽、高                                 | FLOAT                                               | `width`、`height`                                                            | `boundVariables.size.x`、`.y`                                                                                                |
| 最小 / 最大宽高                        | FLOAT                                               | `minWidth` 等                                                                | 同名                                                                                                                         |
| 内边距                                 | FLOAT                                               | `paddingLeft` 等                                                             | 同名                                                                                                                         |
| 自动布局间距、换行间距                 | FLOAT                                               | `itemSpacing`、`counterAxisSpacing`                                          | 同名                                                                                                                         |
| 网格布局的行列间距                     | FLOAT                                               | `gridRowGap`、`gridColumnGap`                                                | 类型包里没有，未确认                                                                                                         |
| 圆角                                   | FLOAT                                               | `cornerRadius`（绑了会拆成四个角）、`topLeftRadius` 等                       | `rectangleCornerRadii.RECTANGLE_TOP_LEFT_CORNER_RADIUS` 等四个（我们的数据是这种），或 `topLeftRadius` 等                    |
| 描边粗细                               | FLOAT                                               | `strokeWeight`、`strokeTopWeight` 等                                         | 分边的是 `individualStrokeWeights.top` 等；整体的 `strokeWeight` 类型包里没有，未确认                                        |
| 图层不透明度                           | FLOAT                                               | `opacity`                                                                    | `opacity`。变量里存的是 0～100，图层上是 0～1，未确认                                                                        |
| 显示 / 隐藏                            | BOOLEAN，值为 `"true"`/`"false"` 的 STRING 也行     | `visible`                                                                    | `visible`                                                                                                                    |
| 文字内容                               | STRING，FLOAT 也行（数字转成文字）                  | `characters`                                                                 | `characters`                                                                                                                 |
| 字体、字重、样式、字号、行高、字间距   | STRING（字体、样式）、FLOAT（其余）                 | `fontFamily` 等，可以只绑一段文字                                            | 节点上是数组 `boundVariables.fontFamily: [...]`；每段的绑定在 `style.boundVariables`、`styleOverrideTable[n].boundVariables` |
| 段间距、首行缩进                       | FLOAT                                               | `paragraphSpacing`、`paragraphIndent`，不能只绑一段                          | 同上                                                                                                                         |
| 纯色填充、描边的颜色                   | COLOR                                               | `paint.boundVariables.color`                                                 | `fills[n].boundVariables.color`、`strokes[n].boundVariables.color`；文字分段的填充是 `textRangeFills`                        |
| 渐变色标                               | COLOR                                               | `colorStop.boundVariables.color`                                             | `gradientStops[n].boundVariables.color`                                                                                      |
| 阴影的颜色、模糊、扩展、偏移；模糊效果 | COLOR、FLOAT                                        | `effect.boundVariables`（`color`、`radius`、`spread`、`offsetX`、`offsetY`） | `effects[n].boundVariables`                                                                                                  |
| 布局网格                               | FLOAT                                               | `sectionSize`、`count`、`offset`、`gutterSize`                               | `layoutGrids[n].boundVariables`，`count` 在这里叫 `numSections`                                                              |
| 组件属性（变体）                       | STRING、FLOAT；BOOLEAN 只能绑值是 true/false 的变体 | `componentProperties[名字].boundVariables.value`                             | `boundVariables.componentProperties[名字]`，以及 `componentProperties[名字].boundVariables`                                  |

不能绑的：图片填充、渐变本身（只有色标）、位置和旋转、约束、自动布局方向和对齐、Noise / Texture / Glass 效果。

出处：[`VariableBindableNodeField`](https://developers.figma.com/docs/plugins/api/VariableBindableNodeField/)、[`VariableBindableTextField`](https://developers.figma.com/docs/plugins/api/VariableBindableTextField/)、[`VariableBindableEffectField`](https://developers.figma.com/docs/plugins/api/VariableBindableEffectField/)、[`VariableBindableLayoutGridField`](https://developers.figma.com/docs/plugins/api/VariableBindableLayoutGridField/)、[`boundVariables`](https://developers.figma.com/docs/plugins/api/properties/nodes-boundvariables/)、[哪些属性能用变量](https://help.figma.com/hc/en-us/articles/15343107263511)、[`rest-api-spec`](https://github.com/figma/rest-api-spec) 的 `api_types.ts`。

### 3.4 一个属性的值怎么算出来

以"按钮背景色绑了 `color/button/bg`"为例：

1. 看 `color/button/bg` 属于哪个集合，比如"语义色"。
2. 从按钮往上找，第一个对"语义色"显式设了模式的图层，用它的模式；都没有就用默认模式。假设是"暗色"。
3. 取 `color/button/bg` 在"暗色"下的值。如果是别名，比如指向 `color/brand/500`，就到 `color/brand/500` 所在的集合（比如"色板"）**重新按第 2 步找模式**，再取值。
4. 一直到取到一个真正的颜色为止。

第 3 步是容易写错的地方：别名链上每一跳都用"这个图层在那个集合里的模式"，不是一路沿用第一个集合的模式。所以变量的值离开具体图层就算不出来。

```ts
function resolve(variableId: string, node: Node): VariableValue {
  const v = variables[variableId];
  const mode = modeOf(node, v.variableCollectionId); // 自己 → 祖先 → page → 集合默认模式
  const raw = v.valuesByMode[mode];
  return isAlias(raw) ? resolve(raw.id, node) : raw;
}
```

官方示例里有一句 `widthVariable.resolveForConsumer(rectangle).value === rectangle.width`，说明图层上存的属性值就是按这个图层当前的模式算好的值。这是"画面不用改"的依据。

出处：[`resolveForConsumer`](https://developers.figma.com/docs/plugins/api/properties/Variable-resolveforconsumer/)、[Working with variables](https://developers.figma.com/docs/plugins/working-with-variables/)。

### 3.5 和样式、组件、Dev Mode、原型的关系

- **样式**：颜色、文字、效果、网格样式里可以用变量；变量里不能用样式。图层用了"值来自变量的样式"，切图层的模式，样式的值也跟着变。
- **组件属性**：变体属性可以绑变量，切变量的模式就能切变体。我们快照里 18.5 万处空的 `boundVariables: {}` 全在实例的 `componentProperties` 上（§4.1），就是这个绑定位置，只是没人用。
- **Dev Mode**：代码片段里用代码名；能看到变量所属的集合、当前模式、值、整条别名链。
- **原型**：有"设变量""设模式""条件分支"三种交互动作，表达式支持加减乘除和比较。和画面无关，以后再说。

出处：[样式和变量](https://help.figma.com/hc/en-us/articles/15871097384471)、[Dev Mode 里的变量](https://help.figma.com/hc/en-us/articles/27882809912471)、[原型里的变量](https://help.figma.com/hc/en-us/articles/15253194385943)。

### 3.6 数据长什么样

**导出 JSON（我们用的 `exportAsync({ format: 'JSON_REST_V1' })`，和 REST 的 `GET /v1/files/:key/nodes` 同格式）**：属性值照常是算好的数，旁边多一个 `boundVariables` 记引用，节点上还可能有 `explicitVariableModes`。没有变量定义。

```json
{
  "id": "6666:145975",
  "type": "FRAME",
  "boundVariables": {
    "rectangleCornerRadii": {
      "RECTANGLE_TOP_LEFT_CORNER_RADIUS": {
        "type": "VARIABLE_ALIAS",
        "id": "VariableID:f140a117…/6343:22"
      }
    }
  },
  "explicitVariableModes": { "VariableCollectionId:1:2": "1:0" }
}
```

（`explicitVariableModes` 这行是按类型包写的示意，我们的数据里一次都没出现过，§4.1。）

**插件 API**：能读到全部定义，任何套餐都能用。我们的 manifest 是 `"documentAccess": "dynamic-page"`，只能用带 `Async` 的版本。

```ts
figma.variables.getLocalVariableCollectionsAsync(): Promise<VariableCollection[]>
figma.variables.getLocalVariablesAsync(type?): Promise<Variable[]>
figma.variables.getVariableByIdAsync(id): Promise<Variable | null>
figma.variables.getVariableCollectionByIdAsync(id): Promise<VariableCollection | null>

interface Variable {
  id; name; key; remote: boolean; variableCollectionId; resolvedType;
  valuesByMode: { [modeId: string]: VariableValue }; // 别名不展开
  scopes; codeSyntax; description; hiddenFromPublishing;
  resolveForConsumer(node): { value; resolvedType };   // 按这个图层的模式算到底
}
interface VariableCollection { id; name; key; remote; modes: { modeId; name }[]; defaultModeId; variableIds; isExtension }
node.explicitVariableModes / node.resolvedVariableModes / node.boundVariables
```

**库变量**：要读别的文件发布的变量，`figma.teamLibrary` 那套接口要在 manifest 里加 `"permissions": ["teamlibrary"]`，而且只能列出名字和类型，不带值；要值得先 `importVariableByKeyAsync(key)` 导进当前文件。文件里已经绑定了的库变量，能不能直接用 `getVariableByIdAsync` 查到值，文档没写，未确认（§8）。

**REST API 的变量接口**：`GET /v1/files/:key/variables/local` 能拿到全部定义，但只有 Enterprise 能用。我们不用 REST，这条只是说明为什么不走这条路。

出处：[`figma.variables`](https://developers.figma.com/docs/plugins/api/figma-variables/)、[`Variable`](https://developers.figma.com/docs/plugins/api/Variable/)、[`figma.teamLibrary`](https://developers.figma.com/docs/plugins/api/figma-teamlibrary/)、[`importVariableByKeyAsync`](https://developers.figma.com/docs/plugins/api/properties/figma-variables-importvariablebykeyasync/)、[REST 变量接口](https://developers.figma.com/docs/rest-api/variables/)、[`ExportSettings`](https://developers.figma.com/docs/plugins/api/ExportSettings/)。

## 4. 我们的数据

### 4.1 有多少

197 份快照，25.8 万个图层（含 `mains` 里的主组件）：

| 项                             | 数量                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| 图层上非空的 `boundVariables`  | 8 个图层，2 个用例                                                                                 |
| 绑的属性                       | 只有圆角（`rectangleCornerRadii` 四个角）                                                          |
| 用到的变量                     | 1 个，`VariableID:f140a117c4865a4ca09a8218e404c5923361eee1/6343:22`，id 里带一段库的 key，是库变量 |
| 填充、描边、效果、文字上的变量 | 0                                                                                                  |
| `explicitVariableModes`        | 0                                                                                                  |
| 空的 `boundVariables: {}`      | 18.5 万处，全在实例的 `componentProperties[名字]` 上                                               |

两个用例是 `cases/real/untitled-ui-free-figma-ui-kit-and-design/settings-pages-desktop-4` 和 `settings-pages-mobile-4`，绑变量的是 4 个叫 "Image" 的 frame。它们的 `cornerRadius` 字段不存在，也就是值为 0。

结论：**现有用例没法用来做变量的功能和测试**，要专门生成一批（§6 第 1 步）。

### 4.2 已经有的

- 导入时 `node` 原样保留 `boundVariables`，画法不看它。
- `apps/client/src/figma/components.ts` 的 `IGNORED` 里有 `boundVariables`：重建实例时这个字段不从主组件拷、也不比较。以后要让绑定跟着主组件走，这里要改（§5.5）。
- 编辑引擎已经有"改了一个东西，连带重算别的图层，撤销一步回去"的机制：组件同步、自动布局重排、重新量文字（`editing/engine.ts`，[tech.md §13.1](tech.md#13-在-tldraw-里编辑2026-10-25用户追加)、[§16.4](tech.md#16-figma-组件2026-10-25用户追加)）。变量联动可以放进同一个地方。

### 4.3 缺什么

1. **变量和集合的定义**：名字、类型、所属集合、每个模式的值、别名。插件一行都没导出（`code.js` 里没有调 `figma.variables`）。
2. **模式**：导出的 frame 从它外面的祖先（section、page）继承来的模式，导出范围里根本没有那些祖先，必须由插件在根节点上补记；导出范围内的图层自己设的模式，`JSON_REST_V1` 会不会带，未确认。
3. **库变量的值**：要实测插件能不能拿到。manifest 现在没有 `teamlibrary` 权限。

## 5. 在我们这边怎么接

### 5.1 做到哪一档

| 档位                 | 用户能做什么                                                 | 要什么                          |
| -------------------- | ------------------------------------------------------------ | ------------------------------- |
| A. 看得见            | 选中图层，面板上看到哪些属性绑了哪个变量、当前是什么模式     | 插件导出定义；面板显示          |
| B. 切模式            | 给 frame 切"亮色 / 暗色"，里面的图层跟着变，自动布局跟着重排 | A + 解析和写回 + 接进编辑引擎   |
| C. 改变量值          | 打开变量表改 `color/bg` 的值，所有绑定的图层一起变           | B + 变量表界面 + 变量数据能撤销 |
| D. 和 Figma 一样完整 | 绑定 / 解绑、新建变量和集合、加模式、别名、作用范围          | C + 一整套编辑界面              |

**建议第一版做到 B。** 切模式是变量最常见的用法（亮暗主题、品牌、手机桌面），也是最能看出"变量在起作用"的一档；而且能用 Figma 导出的另一个模式的截图直接量对不对（§6）。

### 5.2 插件导出什么

快照加一个字段，形状照搬插件 API，方便核对：

```ts
interface Snapshot {
  // …现有字段
  variables?: {
    collections: Record<
      string,
      {
        id: string;
        name: string;
        key: string;
        remote: boolean;
        modes: { modeId: string; name: string }[];
        defaultModeId: string;
      }
    >;
    variables: Record<
      string,
      {
        id: string;
        name: string;
        key: string;
        remote: boolean;
        variableCollectionId: string;
        resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
        valuesByMode: Record<string, VariableValue>; // 别名不展开，导入后自己算
        scopes: string[];
        codeSyntax: Record<string, string>;
        description: string;
      }
    >;
    /** 图层 id → 它自己显式设的模式；导出范围的根节点记 resolvedVariableModes（含祖先继承来的） */
    modes: Record<string, Record<string, string>>;
  };
}
```

- 导出哪些变量：快照里（`rest` 和 `mains`）所有 `boundVariables` 引用到的，加上别名链上的，加上本文件全部本地集合。全部本地集合是为了变量表能列全；会让快照大多少，未测。
- 模式单独放在 `variables.modes`，不改 `rest` 里的节点，和现有的 `transforms`、`textSegments` 一个做法。
- 扩展集合、`EASING` / `TIMING` 变量先不导。

### 5.3 变量数据放在哪

变量不属于某一个图层，是整份文档共用的。建议在画面引擎里加一条文档级的记录（引擎现在有 `document`、`page`、`shape` 三种记录，见 [skia-engine tech.md §3](../skia-engine/tech.md#3-数据层enginestorets2026-10-27)），存集合、变量和每个模式的值。这样改变量值能进撤销历史，导出 `.tldr` 时也带着。

图层上设的模式放在各自的 `node.explicitVariableModes`，和 Figma 一样；绑定照旧放在 `node.boundVariables`。

### 5.4 解析和写回

新写 `apps/client/src/figma/variables.ts`（新）：

- `modeOf(shape, collectionId)`：从图层沿 `parentId` 往上找 `explicitVariableModes`，到根节点用插件记的 `resolvedVariableModes`，都没有用默认模式。
- `resolveVariable(variableId, shape)`：§3.4 的算法，带环检测。
- `applyVariables(node, shape)`：按 §3.3 的表，把每个绑定的值写回对应字段，没变就返回原对象。几个要换算的：`size.x` 改宽要连带 `absoluteBoundingBox`；`rectangleCornerRadii` 写回四个角和 `cornerRadius`；`opacity` 可能要 ÷100；FLOAT 写进 `characters` 要转成文字，格式规则未确认。

什么时候重算：

| 操作                                   | 重算哪些图层                     |
| -------------------------------------- | -------------------------------- |
| 改某个变量的值                         | 绑了它、或绑了指向它的别名的图层 |
| 给某个图层切模式                       | 这个图层的整棵子树               |
| 把图层拖进另一个 frame（模式可能不同） | 被拖的子树                       |
| 绑定 / 解绑                            | 这一个图层                       |

写回之后，宽高、内边距、间距、文字变了的，交给现有的自动布局重排和重新量文字。整个过程算一步撤销。

### 5.5 和组件的关系

- 主组件上的绑定要跟着同步到实例，所以 `components.ts` 的 `IGNORED` 里要去掉 `boundVariables`，改成按字段同步；实例上改绑了别的变量，记成覆盖。
- 实例可以设和主组件不一样的模式（§3.2）。同步顺序是：先按主组件同步字段，再按实例自己的模式算变量，最后重排。否则实例会拿到主组件那个模式下的值。
- 变体属性绑变量（§3.5）先不做。

### 5.6 界面

- **属性面板**：绑了变量的字段显示变量名的标签，旁边一个解绑按钮。Figma 里在画布上拖内边距、间距的手柄会自动解绑；在输入框里直接输数字是不是也解绑，未实测。
- **frame 的模式**：面板上加一块"外观"，列出这个图层用到的集合，每个一个下拉框（自动 / 各个模式）。
- **变量表**（C 档）：集合在左，变量一行一个，模式一列一个，单元格能改；库变量灰掉只读。
- **右栏 inspector**（`/import`、`/compare`）：显示原始的 `boundVariables` 和解析出来的变量名，A 档就能做。

## 6. 建议的步骤

每一步都能单独跑、单独验收，都不改导入时的画法，现有 175 个用例的还原度要和现在一样。

| 步骤 | 内容                                                                                                                                                                                                                                                     | 怎么验收                                                                                       | 工作量（估计） |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------- |
| 1    | 插件生成 `variables/*` 用例：建"主题"颜色集合（亮色 / 暗色，有别名链）和"间距"数字集合（紧凑 / 宽松）；绑填充、描边、渐变色标、阴影颜色、圆角、内边距、间距、宽、文字内容、字号、显示隐藏；同一个 frame 复制几份、每份设不同模式。顺带实测 §8 的未确认项 | 新用例导出后还原度 < 1%（画法不用改，这一步验证的是"导出的值是算好的"）；§8 每一项写下实测结果 | 小～中         |
| 2    | 插件导出 `variables`（§5.2）；导入时放进文档记录；写 `variables.ts` 的解析                                                                                                                                                                               | 正式测试：把"亮色"那份的图层按"暗色"解析，结果和 Figma 导出的"暗色"那份逐字段一致              | 中             |
| 3    | A 档：面板和 inspector 显示绑定的变量名和当前模式                                                                                                                                                                                                        | 手动：选中绑了变量的图层，看到变量名                                                           | 小             |
| 4    | B 档：frame 上切模式，子树跟着变，自动布局重排，撤销一步回去；实例的同步顺序（§5.5）                                                                                                                                                                     | 把"亮色"那份切成"暗色"，截图和 Figma 的"暗色"截图差异 < 1%；单测：撤销、嵌套模式、别名跨集合   | 中             |
| 5    | C 档：变量表，改值联动                                                                                                                                                                                                                                   | 单测：改值后绑定的图层都变、没绑的不变；手动：改主题色，整页跟着变                             | 中             |
| 6    | D 档：绑定 / 解绑、新建变量和集合、加模式                                                                                                                                                                                                                | 手动                                                                                           | 中～大         |

以后再说：扩展集合、`EASING` / `TIMING`、原型里的变量和条件、变体属性绑变量、导出代码名。

## 7. 要用户定的

> 2026-10-29 用户说"1-5 都做了吧"：做到 §6 的第 5 步（C 档，能改变量值）；其余四条按建议定：插件在测试文件里建变量集合，变量数据放文档级记录，库变量只读，导出全部本地变量加上用到的库变量。实现见 [tech.md §21](tech.md#21-figma-变量2026-10-29用户追加)，步骤见施工计划第 13 步。

> 2026-10-29 补：用户的测试文件在 Figma 免费版（Starter）团队里，插件给集合加第二个模式时 Figma 报 `Limited to 1 modes only`。用户选了改成免费版能做的用例：每个集合 1 个模式，暗色、宽松各用一个集合，用"换成另一个集合的值"代替切模式来对照 Figma（tech.md §21.1、§21.7）。所以下面 §8 里和模式有关的两条（`explicitVariableModes`、主组件的模式带不带到实例）这次实测不了。

1. 第一版做到哪一档（§5.1）？建议做到 B（切模式），也就是第 1～4 步。
2. 第 1 步要让插件在 Figma 测试文件里新建两个变量集合来生成用例，可以吗？
3. 变量数据放在文档级的一条新记录里（§5.3），可以吗？这是数据层的改动。
4. 库变量只读，拿不到值时只显示名字，可以吗？
5. 插件导出全部本地变量，还是只导用到的（§5.2）？建议全部本地变量加上用到的库变量。

## 8. 未确认、要实测的

第 1 步在插件里一项项试，结果写回这里（2026-10-29，用户的免费版文件，6 个单模式用例，tech.md §21.1）。

| 问题                                                                        | 为什么要紧                 | 实测结果（2026-10-29）                                                                                                                                       |
| --------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `JSON_REST_V1` 导出里有没有 `explicitVariableModes`                         | 没有就得插件自己逐个图层记 | 没测：免费版做不了多个模式，用例里没有设模式的图层。插件照旧自己记（tech.md §21.2）                                                                          |
| 文件里已经绑定的库变量，`getVariableByIdAsync` 能不能查到值                 | 决定库变量能不能切模式     | 没测：测试文件没接库。Untitled UI 那几页的库变量仍然读不到（面板显示"读不到的变量"）                                                                         |
| `importVariableByKeyAsync` 要不要 `teamlibrary` 权限、会不会改动 Figma 文件 | 插件导出不能改用户的文件   | 没用这个函数，没测                                                                                                                                           |
| 库变量 id 里那段 key 是什么，库重新发布后会不会变                           | 决定 id 能不能当长期的键   | 没测                                                                                                                                                         |
| 主组件上设的模式会不会带到实例上                                            | 影响 §5.5 的同步           | 没测：同第一条                                                                                                                                               |
| 整体 `strokeWeight`、网格间距绑了变量，导出 JSON 里键叫什么                 | 类型包里没有这几个键       | `setBoundVariable('strokeWeight')` 在导出 JSON 里变成 `individualStrokeWeights.BORDER_TOP_WEIGHT` 等四个键，值在 `strokeWeight`；网格间距没测                |
| `opacity`、`lineHeight` 变量的单位；FLOAT 写进文字内容时怎么格式化          | 写回时要换算               | opacity 变量 50 → `opacity: 0.5`；lineHeight 变量 30 → `lineHeightPx: 30`、单位 `PIXELS`；插件 API 不让 FLOAT 变量绑文字内容（报错，用例里标了 Unsupported） |

另外两条事先没想到的：

- 整段文字的字号、行高绑了变量时，绑定只在节点上的数组里（`boundVariables.fontSize: [别名]`），`style.boundVariables` 是空的；分段样式的绑定在 `styleOverrideTable[n].boundVariables`。导入时挪进 `style`（tech.md §21.4 的 `withTextBindings`）。
- 渐变色标可以直接在色标对象里写 `boundVariables` 绑变量，导出 JSON 里也带着。

## 9. 风险

| 风险                                                                    | 应对                                                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 现有用例几乎没有变量，做出来没东西验                                    | 第 1 步先生成用例；再找几套大量用变量的社区稿子补成真实稿子用例                                                                                  |
| 别名跨集合时模式算错（§3.4）                                            | 用例里专门放跨集合的别名链；第 2 步的逐字段对比会抓到                                                                                            |
| 切模式改了宽度、内边距，自动布局重排和 Figma 不一致                     | 自动布局算法已经对过 5907 个 frame（[probe-editing.md](probe-editing.md)）；第 4 步用截图对比兜底                                                |
| 一个变量绑了几千个图层，改一次值要重算很多                              | 导入时建"变量 → 图层"的索引；先整页重算量耗时，慢了再只算受影响的                                                                                |
| 快照变大                                                                | 第 2 步量一下真实稿子导出前后的大小；太大就只导用到的变量                                                                                        |
| 字段名在插件 API 和导出 JSON 里不一样（§3.3），漏换一个就静默失效       | 映射表写成一处常量，单测覆盖表里每一行                                                                                                           |
| 套餐限制（模式数、扩展集合只有 Enterprise）导致用例在别的账号上做不出来 | 用例只用 2 个模式、不用扩展集合。2026-10-29 实测：免费版每个集合只能有 1 个模式（报 `Limited to 1 modes only`），用例改成单模式（tech.md §21.1） |
