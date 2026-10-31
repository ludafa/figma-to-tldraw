# 设计稿方言：技术实现

> 相关：[模块说明](README.md) · [产品设计](product.md) · [施工计划](plan.md) · [验证方案](verification.md)

这份文档写"Figma 快照怎么变成方言代码"，以及检查用的反方向"方言代码怎么变回快照"。还没开工，下面都是设计，没标"用户"的做法都是我的建议。

## 1. 总体流程（2026-10-31）

```
cases/<…>/snapshot.json（一个 Figma 文件导出的若干页）
   │ ① 规范化：按主组件重建实例（components.ts 的 rebuildTree），补默认值，去掉派生字段（§13.2）
   ▼
中间树（每个节点一个元素：标签名 + 属性 + 子元素，属性已经是方言的写法）
   │ ② 打印成 TSX，按 §10 分文件，用仓库的 oxfmt 格式化
   ▼
designs/<文件名>/（方言 repo：pages/、components/、tokens/、assets/、dialect/、AGENTS.md）

检查用的反方向：
designs/<文件名>/ ──③ 解析（不执行）──▶ 中间树 ──④ 展开实例、查 token──▶ 快照 ──① 规范化──▶ 和原快照逐字段比
```

- **中间树**（`dialect/model.ts`，新）是两个方向共用的结构。正反两步分开测：打印和解析只管语法（中间树 → 代码 → 中间树一样），映射只管语义（快照 → 中间树 → 快照一样）。
- **一次导入一个 Figma 文件。** `cases/index.json` 里每个用例有 `source.figmaFile` 和 `source.page`，同一个文件的用例合成一个 repo，主组件按 node id 去重（§10）。
- **生成在 Node 里跑。** 导入是一次性的，命令行就够；以后要在 `/import` 页面里导入时，再看生成器能不能搬到浏览器。
- **这一步不碰画布。** 引擎、`to-shapes.ts`、编辑器都不改。把方言代码画到画布上是路线第 4 步（[产品方向 plan.md](../product-direction/plan.md)），这里的反方向只用来检查生成得对不对。

**反方向解析代码、不执行。** 和产品方向 product.md §6 的建议一致：画布改动要写回代码，无论如何都要解析源码；解析的结果确定，也不用在产品里执行 agent 写的代码。所以方言是 TSX 的一个子集，能用的语法在 §13.1 列出来。

## 2. 只写意图，不写结果（2026-10-31）

Figma 导出的数字有两种：设计师定的（固定宽 343、间距 12、左边距 16），和 Figma 按规则算出来的（包裹内容的 frame 有多宽、自动布局里每个子图层在哪）。**代码里只写设计师定的，算出来的不写，由我们的排版引擎重算。**

| 数字                                          | 写不写                                                 | 理由                                               |
| --------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| 固定尺寸（`FIXED`）                           | 写 `width` / `height`                                  | 设计师定的                                         |
| 包裹内容（`HUG`）、填充（`FILL`）             | 不写尺寸，写 `flex: 1` / `alignSelf: 'stretch'`        | 算出来的；写了数字，agent 会按 RN 理解成固定宽     |
| 自动布局里子图层的位置                        | 不写                                                   | 算出来的                                           |
| 不是自动布局的父图层里子图层的位置            | 写 `left` / `top`                                      | 设计师摆的                                         |
| 文字框的大小（自动宽、自动高）                | 不写，写了哪边就是哪边固定（§6.2）                     | 量出来的                                           |
| 组的框                                        | 不写，按子图层算（§4.4）                               | Figma 也是按子图层算的                             |
| 实例里的图层                                  | 只写覆盖（§8.3），位置尺寸都不写                       | 结构来自主组件，排版由引擎算                       |
| `absoluteBoundingBox`、`absoluteRenderBounds` | 不写；矢量的渲染范围按相对自己框的偏移放进资源（§7.2） | 编辑以后就不准了（产品方向 product.md §8 第 6 条） |

这样做的好处：agent 改了间距或文字，周围自动重排，不会留下一堆过时的坐标；代码和 RN 的读法一致。

代价是**打开时要整页重排**：量所有文字、排所有自动布局、算所有组的框。现有引擎能不能排出和 Figma 一样的结果，有过两个实测：

- 自动布局：`auto-layout.test.ts` 把每个用例整棵树重排一遍，21085 个图层里 59 个动了，原因都已知（figma-to-tldraw tech.md §13.2）。这个测试用的是 Figma 量好的文字尺寸。
- 文字：2812 段文字里 2811 段量出来的行数和 Figma 一样（figma-to-tldraw probe-editing.md §3.5），宽度差多少没量过。

两个都没测过"导入后全部重新量、全部重排，截图还原度掉多少"。这是阶段 0 要先测的（[plan.md](plan.md)）。掉得多就退一步：导入时把 Figma 算好的框存一份"排版缓存"（`.fg/layout.json`，按 node id），代码没改过的屏幕直接用缓存，改过才重排。缓存要判断"改过没有"，复杂度高，没必要就不做。

## 3. 元素（2026-10-31）

每个 Figma 节点写成一个元素，树的结构和 Figma 一一对应（原始方案原则 3）。括号里是 203 个用例页面上的个数（实测，统计方法见 §15）。

| Figma 类型                                                            | 方言元素                                         | 说明                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| `FRAME`（5120）                                                       | `View`                                           |                                                                  |
| `TEXT`（4878）                                                        | `Text`                                           | 分段样式用嵌套 `Text`（§6.4）                                    |
| `INSTANCE`（6934）                                                    | 组件名，如 `<Button>`                            | 一行加覆盖（§8.3）；主组件不在文件里的写成 `Fg.Instance`（§8.5） |
| `RECTANGLE`（945）                                                    | `Fg.Rect`；只有一张图片填充时写 `Image`          | §7.1                                                             |
| `GROUP`（728）                                                        | `Fg.Group`                                       | 没有自己的坐标系（§4.4）                                         |
| `VECTOR`（3679）                                                      | `Fg.Vector`                                      | 画法放资源（§7.2）                                               |
| `ELLIPSE`（282）、`LINE`（165）、`STAR`（11）、`REGULAR_POLYGON`（1） | `Fg.Ellipse`、`Fg.Line`、`Fg.Star`、`Fg.Polygon` | 同上                                                             |
| `BOOLEAN_OPERATION`（65）                                             | `Fg.Boolean`                                     | `fg-booleanOperation="SUBTRACT"`；子图层照写                     |
| `SECTION`                                                             | `Fg.Section`                                     | 用例的根有时是 section                                           |
| `COMPONENT`、`COMPONENT_SET`                                          | `Fg.Component`、`Fg.ComponentSet`                | 只出现在 `components/` 里（§8.1）                                |

`View`、`Text`、`Image` 借 RN 的名字，因为意思一样：`View` 是能放子元素的盒子，`Text` 是文字，`Image` 是一张图。Figma 独有的元素都放在 `Fg.` 下面。矩形不写成 `View`：矩形不能有子图层、不能自动布局，类型丢了就变不回去。

**每个元素都带的属性：**

- `nodeId`：Figma 的 node id，字符串。实例里的图层不写（它们来自主组件），覆盖按主组件里图层的 id 写（§8.3）。
- `name`：图层名，原样保留（原始方案 §9 第 6 条）。文字图层的名字和内容一样时不写，求值时名字跟着内容走，和 Figma 改文字时自动改名一样。
- `style`：只放和 RN **同名同义**的键（§4～§6 的表），值可以是数字、字符串、token（§9）。
- `fg-*`：Figma 独有的属性。

### 3.1 fg- 属性的命名规则（建议，待用户定）

**`fg-` 后面接 Figma 导出 JSON（REST）里的字段名，取值也照 REST 写**，只有颜色统一写成十六进制（§5.1）。比如描边写成 `fg-strokes`、`fg-strokeWeight`、`fg-strokeAlign="INSIDE"`，约束写成 `fg-constraints={{ horizontal: 'SCALE', vertical: 'TOP' }}`。文字 `style` 里的字段当成节点上的字段，比如 `style.fontStyle` 写成 `fg-fontStyle`。

| 方案                                                                                      | 结论                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fg-` + REST 字段名，取值照 REST                                                          | ✅ 建议：一条规则管所有字段，不用另起一套词汇、写一套说明；agent 能直接用它对 Figma 的知识；转换几乎是原样搬；还没建模的字段也能按这条规则原样写出来（§11），不用另做兜底 |
| 原始方案的写法：自己起名、合并成一个对象，如 `fg-stroke={{ width: 1, align: 'outside' }}` | ❌ 读起来短一点，但每个字段都要起名、写说明、写转换，起的名字还可能和 Figma 的意思对不齐                                                                                  |
| 照插件 API 的名字                                                                         | ❌ 我们的数据是 REST 格式，几处名字和取值不一样（约束是 `MIN` / `MAX` / `STRETCH`，渐变是 `gradientTransform`），要多一层换算                                             |

这条和产品方向 product.md §9 第 5 条是同一个待定问题。

## 4. 布局（2026-10-31）

名字借 RN 的 flexbox，**算法照 Figma**：求值和画布排版都用 `figma/editing/auto-layout.ts`，不换成 Yoga（产品方向 product.md §5 第 3 条）。下面的"同义"指在 Figma 的规则下意思一样，不是说 Yoga 会排出同样的结果。布局属性一律显式写出，不靠 RN 的默认值（RN 默认 `flexDirection: 'column'`、`alignItems: 'stretch'`，Figma 没有这种默认）。

### 4.1 自动布局的 frame

| Figma（REST）                                                            | 方言                                                                            | 说明                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `layoutMode: HORIZONTAL` / `VERTICAL`（5253 / 3095）                     | `flexDirection: 'row'` / `'column'`                                             | `NONE` 不写，子图层都是绝对定位（§4.3）                                                |
| `itemSpacing`                                                            | `gap`                                                                           | 两端对齐时 Figma 不用这个值，改写成 `fg-itemSpacing`，免得和 RN 的 gap（最小间距）混淆 |
| `paddingTop/Right/Bottom/Left`                                           | `paddingTop` 等                                                                 | 四边相等写 `padding`，上下、左右各自相等写 `paddingVertical` / `paddingHorizontal`     |
| `primaryAxisAlignItems` MIN / CENTER / MAX / SPACE_BETWEEN               | `justifyContent` `'flex-start'` / `'center'` / `'flex-end'` / `'space-between'` |                                                                                        |
| `counterAxisAlignItems` MIN / CENTER / MAX / BASELINE                    | `alignItems` `'flex-start'` / `'center'` / `'flex-end'` / `'baseline'`          | 一律写出来                                                                             |
| `layoutWrap: WRAP`（5）、`counterAxisSpacing`、`counterAxisAlignContent` | `flexWrap: 'wrap'`、`rowGap` / `columnGap`、`alignContent`                      | 换行现在不重排（figma-to-tldraw tech.md §13.2），只保证写得出、变得回                  |
| `layoutMode: GRID`（0）                                                  | `fg-layoutMode="GRID"` 加 REST 的网格字段                                       | 用例里没有                                                                             |
| `itemReverseZIndex`（First on top）                                      | `fg-itemReverseZIndex`                                                          |                                                                                        |
| `strokesIncludedInLayout`（68）                                          | `fg-strokesIncludedInLayout`                                                    |                                                                                        |
| `clipsContent: true`（4194）                                             | `overflow: 'hidden'`                                                            | 不是自动布局的 frame 也一样                                                            |

### 4.2 尺寸

一个图层的宽和高各自看它的尺寸方式（`layoutSizingHorizontal` / `layoutSizingVertical`；没有新字段时按旧字段推，规则同 `auto-layout.ts` 的 `axisSizing`）：

| 尺寸方式（203 个用例：宽 / 高）                     | 方言                        |
| --------------------------------------------------- | --------------------------- |
| `FIXED`（5159 / 5297）                              | `width: 343` / `height: 48` |
| `HUG`（6770 / 10769）                               | 不写                        |
| `FILL`（4329 / 192），在父图层的主轴上              | `flex: 1`                   |
| `FILL`，在父图层的交叉轴上                          | `alignSelf: 'stretch'`      |
| `minWidth` / `maxWidth` / `minHeight` / `maxHeight` | 同名                        |

`flex: 1` 在 RN 里是"放大 1、缩小 1、基准 0"，Figma 的填充是平分剩下的空间、可以压缩，意思对得上。

### 4.3 绝对定位和约束

父图层不是自动布局（4996 个），或者自己设了 `layoutPositioning: ABSOLUTE`（30 个）：

```tsx
<Fg.Rect
  nodeId="40:2"
  style={{ position: 'absolute', left: 16, top: 120, width: 343, height: 48 }}
  fg-constraints={{ horizontal: 'LEFT_RIGHT', vertical: 'TOP' }}
/>
```

- `left` / `top` 是相对父图层左上角的位置，宽高按 §4.2。
- 约束是 `LEFT` / `TOP`（默认）时不写 `fg-constraints`。页面加主组件里，不是自动布局的 frame 的子图层约 43% 是 `SCALE` / `SCALE`、38% 是 `LEFT` / `TOP`（实测，主组件按页重复计）。
- 没用 RN 的 `right` / 百分比来表达约束：`LEFT_RIGHT` 写成 `left` + `right`、`SCALE` 写成百分比都说得通，但 `CENTER` 表达不了，一半用 RN 写法、一半用 `fg-` 反而难懂；百分比还会把 `left: 16` 变成 `'4.102564%'`。

### 4.4 组

```tsx
<Fg.Group nodeId="50:1" name="Logo">
  <Fg.Vector nodeId="50:2" style={{ position: 'absolute', left: 24, top: 18, width: 20, height: 20 }} … />
  <Text nodeId="50:3" style={{ position: 'absolute', left: 50, top: 16 }}>Acme</Text>
</Fg.Group>
```

- `Fg.Group` 本身不写位置和尺寸，框按子图层算。子图层的 `left` / `top` **相对最近的一个不是组的祖先**，和 Figma 一样（组没有自己的坐标系）。这是 `Fg.` 元素的特例，要写进 AGENTS.md。
- 这样挪一个子图层只改它自己那一行；如果按 RN 的习惯相对组来写，挪一下组的框就变了，所有兄弟的坐标都要跟着改。
- 框能不能按子图层算出来（实测，§15）：1555 个组里 1514 个（97%）等于子图层框的并集；41 个对不上，30 个带蒙版、11 个是旋转过的矢量插画，规则还没找到。组的子图层位置不依赖组的框，所以只在组放在自动布局里、或者看选框时有影响。阶段 0 一起看截图差多少。
- `Fg.Boolean` 的框是运算结果的框（相减、相交时比子图层小），134 个里 44 个不等于并集，没有几何运算算不出来，所以 `Fg.Boolean` 照写 `width` / `height`，算是"结果"里的例外。

### 4.5 旋转和镜像

旋转过的图层 328 个、镜像的 48 个（203 个用例页面）。写成 RN 的 `transform`：

```tsx
style={{ position: 'absolute', left: 100, top: 40, width: 80, height: 20, transform: [{ rotate: '-30deg' }, { scaleX: -1 }] }}
```

- RN 的意思：`left` / `top` / `width` / `height` 是**没转之前**的框，再绕框的中心转。Figma 的矩阵（`transforms[id].m`）换算过来：中心点不变，没转之前的左上角 = 中心 − 宽高的一半；角度 = `atan2(b, a)`；行列式小于 0 时加 `scaleX: -1`。来回换算只有浮点误差。
- 旋转方向：RN 的正角度是顺时针（y 轴朝下）。换算时按矩阵算，不看 REST 的 `rotation`（弧度，正负号和 Figma 界面相反，figma-to-tldraw tech.md §1.2）。
- 好处：绕中心转只改 `transform` 一项；agent 对 RN 的 transform 很熟。
- 和 Yoga 的区别：RN 里 transform 不影响排版，Figma 自动布局里旋转过的子图层按外接框占位。这条照 Figma（`auto-layout.ts` 的规则表第一条）。

> 2026-10-31 修订产品方向 product.md §5 第 3 条：那里建议"用变换矩阵"。矩阵和 RN 的 transform 都能无损换算，transform 读起来懂的人多，改成建议用 transform。

## 5. 外观（2026-10-31）

| Figma                                                   | 方言                                                                                                                                       | 说明                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 只有一层看得见的纯色填充，透明度 1，混合模式普通        | `backgroundColor: '#7F56D9'`；文字用 `color`                                                                                               | 隐藏的填充（2904 层）也算"一层"，有就走下一行                                             |
| 其他填充（多层 789、渐变 269、图片 1279、带透明度 309） | `fg-fills={[…]}`                                                                                                                           | 每层照 REST 的 paint 写，去掉默认值；图片的 `imageRef` 照写，图片文件按 hash 放资源（§7） |
| 描边（看得见的 3704：居中 1574、内侧 1480、外侧 650）   | `fg-strokes`、`fg-strokeWeight`、`fg-strokeAlign`、`fg-individualStrokeWeights`（874）、`fg-strokeDashes`、`fg-strokeCap`、`fg-strokeJoin` | 不用 `borderWidth`：RN 的边框占排版空间，Figma 的描边不占（原始方案原则 1）               |
| 圆角 `cornerRadius`                                     | `borderRadius`                                                                                                                             |                                                                                           |
| 四个角不一样 `rectangleCornerRadii`（111）              | `borderTopLeftRadius` 等                                                                                                                   |                                                                                           |
| `cornerSmoothing`（437）                                | `fg-cornerSmoothing`                                                                                                                       | 圆角照写，平滑是额外的                                                                    |
| 效果（投影 560、背景模糊 49、内阴影 40、图层模糊 20）   | `fg-effects={[…]}`                                                                                                                         | 不用 RN 的 `boxShadow`：Figma 的投影跟着形状和文字走，还有 `showShadowBehindNode`         |
| `opacity`                                               | `opacity`                                                                                                                                  | 都是整组变淡（skia-engine tech.md §7.4）                                                  |
| `blendMode`（非默认 130，多是 MULTIPLY）                | `fg-blendMode`                                                                                                                             | 不用 RN 的 `mixBlendMode`：Figma 有 `PASS_THROUGH`                                        |
| `visible: false`（779）                                 | `display: 'none'`                                                                                                                          | RN 里也是不画、不占排版空间                                                               |
| `isMask`（12）、`maskType`                              | `fg-isMask`、`fg-maskType`                                                                                                                 | 蒙版仍是兄弟节点，裁剪排在它后面的兄弟（原始方案 §3.2 类别 3）                            |

### 5.1 颜色和数字

- **颜色写十六进制**：`'#7F56D9'`，有透明度写 `'#7F56D980'`。Figma 存的是 0～1 的小数，203 个用例里 89% 的颜色正好是 8 位的（乘 255 是整数），这些写十六进制没有损失；另外 11%（填充和描边 1850 个、渐变色标 83 个）不是，写成 `{ r: 0.4985, g: …, b: …, a: 1 }` 原值，不能四舍五入成十六进制。
- **数字写最短的、变回 float32 不变的写法**：Figma 内部用 float32，导出的 `16.000000953674316` 写成 `16`、`0.20000000298023224` 写成 `0.2`。比较时按 float32 比（§13.2）。

## 6. 文字（2026-10-31）

```tsx
<Text
  nodeId="1:5"
  name="Title"
  style={{ alignSelf: 'stretch', color: '#101828', textAlign: 'center' }}
  fg-textStyle={t.text['Display xs/Semibold']}
>
  {'欢迎回来\n今天想学点什么？'}
</Text>
```

### 6.1 内容

- 内容写在子元素里。JSX 会吞掉跨行的空白，所以内容里有换行、首尾空格、连续空格、`{ } < >` 时写成字符串 `{'…'}`；只有普通文字时直接写，和 RN 一样。
- 段内换行 U+2028 写成 ` `（figma-to-tldraw tech.md §12.5）。

### 6.2 尺寸

文字框的尺寸方式由写了哪边推出来，和 RN 的 `Text` 一样"不写就跟着内容"：

| `textAutoResize`（203 个用例） | 方言                                                  |
| ------------------------------ | ----------------------------------------------------- |
| `WIDTH_AND_HEIGHT`（2838）     | 不写宽高                                              |
| `HEIGHT`（1925）               | 写宽（或 `flex: 1` / `alignSelf: 'stretch'`），不写高 |
| `NONE`（104）                  | 宽高都写                                              |
| `TRUNCATE`（11）               | 宽高都写，加 `fg-textAutoResize="TRUNCATE"`           |

### 6.3 样式

| Figma `style`                                                        | 方言                                                           | 说明                                                                                                            |
| -------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 绑了文字样式（3839 个节点）                                          | `fg-textStyle={t.text['…']}`                                   | 字体相关的字段都来自样式，`style` 里不再写（§9.2）                                                              |
| `fontFamily`                                                         | `fontFamily`                                                   |                                                                                                                 |
| `fontStyle`（"Semi Bold"、"Bold Italic"）                            | `fg-fontStyle`                                                 | 不写 `fontWeight`：Figma 按样式名挑字体，数字字重会丢信息；也不能用 RN 的 `fontStyle`，那个只有 normal / italic |
| `fontSize`                                                           | `fontSize`                                                     |                                                                                                                 |
| `lineHeightUnit: PIXELS`（4260）                                     | `lineHeight: 24`                                               |                                                                                                                 |
| `lineHeightUnit: FONT_SIZE_%`（84）                                  | `fg-lineHeight="150%"`                                         | RN 只有像素                                                                                                     |
| `lineHeightUnit: INTRINSIC_%`（534）                                 | 不写                                                           | 字体自己的行高，RN 不写也是这个意思                                                                             |
| `letterSpacing`（非 0 的 333）                                       | `letterSpacing`                                                | REST 只给像素；设计师原来设的百分比导出时就没了                                                                 |
| `textAlignHorizontal` LEFT / CENTER / RIGHT / JUSTIFIED              | `textAlign` `'left'` / `'center'` / `'right'` / `'justify'`    |                                                                                                                 |
| `textAlignVertical` TOP / CENTER / BOTTOM                            | `textAlignVertical` `'top'` / `'center'` / `'bottom'`          | RN 里只有 Android 认，意思一样                                                                                  |
| `textCase` UPPER / LOWER / TITLE（81）                               | `textTransform` `'uppercase'` / `'lowercase'` / `'capitalize'` | 小型大写字母等其他值写 `fg-textCase`                                                                            |
| `textDecoration` UNDERLINE / STRIKETHROUGH（56）                     | `textDecorationLine` `'underline'` / `'line-through'`          |                                                                                                                 |
| `maxLines` + `textTruncation: ENDING`（16）                          | `numberOfLines={2}`                                            | RN 的 `numberOfLines` 就是超出部分显示"…"；只有截断、没有行数时写 `fg-textTruncation`                           |
| `paragraphSpacing`（非 0 的 1812）、`paragraphIndent`、`listSpacing` | `fg-paragraphSpacing` 等                                       |                                                                                                                 |
| 其他（`opentypeFlags`、`hyperlink` 等）                              | `fg-` + 字段名                                                 | §3.1                                                                                                            |

### 6.4 分段样式（138 段）

Figma 存"整段样式 + 每个字符的覆盖号（`characterStyleOverrides`）+ 覆盖表（`styleOverrideTable`）"。方言里写成嵌套 `Text`，子 `Text` 只写和整段不一样的字段：

```tsx
<Text
  nodeId="3:1"
  style={{ fontFamily: 'Inter', fontSize: 16, color: '#475467' }}
  fg-fontStyle="Regular"
>
  已有账号？
  <Text style={{ color: '#7F56D9' }} fg-fontStyle="Semi Bold">
    登录
  </Text>
</Text>
```

- RN 的嵌套 `Text` 会继承外层样式，正好对上 Figma 的"整段 + 分段覆盖"（产品方向 product.md §5 第 3 条）。只嵌套一层。
- 覆盖号本身没有意义，求值时按出现顺序重新编号，比较时两边都重新编号（§13.2）。
- 换行符自己的覆盖号（figma-to-tldraw tech.md §13.3）：换行符跟着它所在的那一段。重新编号后和原来不一样的，比较时只要求每个字符的样式一样。
- 按段的属性（插件导出的 `textSegments`，28 个节点）写成 `fg-textSegments`；列表（`lineTypes`、`lineIndentations`，6 个节点）写成 `fg-lineTypes`、`fg-lineIndentations`。这几个都少，先原样写。

## 7. 图片、矢量和资源（2026-10-31）

只需搬运的数据放进 `assets/`，代码里只写引用（原始方案原则 6）。

### 7.1 图片

- 图片文件放 `assets/images/<hash>.<扩展名>`，hash 就是 paint 的 `imageRef`（`meta.images` 的 key）。带滤镜的渲染版本（`meta.filteredImages`）一起搬，图片滤镜自己算以后（figma-to-tldraw tech.md §22）就不用了。
- **只有一层图片填充的矩形写成 `Image`**：`<Image nodeId="7:2" source={asset('images/3f9a…')} resizeMode="cover" style={{ … }} />`。`scaleMode` 是 FILL（1086）写 `cover`，FIT（2）写 `contain`，意思和 RN 一样。
- 其他情况（REST 的 `STRETCH` 在 Figma 界面上叫"裁剪"（188），和 RN 的 stretch 不是一回事；平铺 3 个；有滤镜 39 个；还有别的填充）用 `Fg.Rect` 加 `fg-fills`。

### 7.2 矢量

- `assets/vectors/<id>.json`：插件导出的 SVG（`svgs[id]`）加上渲染范围相对图层框的偏移（`absoluteRenderBounds` − `absoluteBoundingBox` 的左上角，加宽高）。隐藏矢量的 `hiddenRenderBounds`、蒙版的轮廓（`meta.masks`）也放这里。
- 代码：`<Fg.Vector nodeId="20:4" name="Badge" src={asset('vectors/20-4')} style={{ width: 24, height: 24 }} fg-fills={[…]} />`。填充、描边照 §5 写在元素上：现在画的是 SVG，改了颜色画面不变（产品方向 product.md §8 第 1 条），但它们是真实数据，等矢量按几何数据画（路线第 2 步）就生效。AGENTS.md 要写明这一点。
- 插件以后导出路径数据（`fillGeometry` / `strokeGeometry` / `vectorNetwork`，路线第 1 步）时也放进这个 json，代码不变。
- `fillOverrideTable`（715 个节点，矢量的分区填充）跟着几何数据走，也放这个 json。
- **不折叠**原始方案 §6.2 第 3 步说的"纯矢量子树"：折叠和一一对应冲突，页面上能折叠的只有 0.7%（产品方向 product.md §5 第 5 条）。组件文件太长再说。

## 8. 组件和实例（2026-10-31）

### 8.1 组件文件

每个主组件或组件集一个目录 `components/<名字>.<id>/`：

| 文件            | 内容                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `index.ts`      | **接口**：props 的类型、每个属性对应 Figma 的哪个属性和默认值、文件里有几个实例。agent 用组件时主要读这个        |
| `component.tsx` | **结构**：组件集写成 `<Fg.ComponentSet>`，下面每个变体一个 `<Fg.Component>`；单个主组件就是一个 `<Fg.Component>` |

```ts
// components/button.10-1/index.ts
/** @figma component-set 10:1 "Button" · 4 个变体 · 文件里 42 个实例 */
import { componentSet } from '../../dialect';

export interface ButtonProps {
  /** 变体 "Hierarchy" */
  hierarchy: 'Primary' | 'Secondary';
  /** 变体 "Size" */
  size: 'sm' | 'md';
  /** 文字属性 "Label#12:0"，默认 "Button" */
  label?: string;
  /** 布尔属性 "Show icon#12:1"，默认 true */
  showIcon?: boolean;
}

export const Button = componentSet<ButtonProps>('10:1', {
  hierarchy: { figma: 'Hierarchy', type: 'VARIANT' },
  size: { figma: 'Size', type: 'VARIANT' },
  label: { figma: 'Label#12:0', type: 'TEXT', default: 'Button' },
  showIcon: { figma: 'Show icon#12:1', type: 'BOOLEAN', default: true },
});
```

```tsx
// components/button.10-1/component.tsx
export default function ButtonSet() {
  return (
    <Fg.ComponentSet nodeId="10:1" name="Button" style={{ … }}>
      <Fg.Component nodeId="10:2" name="Hierarchy=Primary, Size=md" style={{ flexDirection: 'row', … }}>
        <Fg.Vector nodeId="10:3" name="Icon" src={asset('vectors/10-3')} fg-bind={{ visible: 'showIcon' }} … />
        <Text nodeId="10:4" name="Label" fg-bind={{ children: 'label' }} …>Button</Text>
      </Fg.Component>
      {/* 其他变体 */}
    </Fg.ComponentSet>
  );
}
```

- **变体写成联合类型**：agent 写了不存在的变体，类型检查直接报错（原始方案 §4.1）。
- **属性名**：Figma 的属性名（"Show icon#12:1"）转成驼峰（`showIcon`），重名加后缀，和 `nodeId`、`name`、`style`、`children` 撞名的后面加 `_`。原名记在 `figma` 里，变回去不丢。变体的值照 Figma 原样写字符串。
- **属性管哪个图层**（`componentPropertyReferences`，152 个）：`fg-bind={{ visible: 'showIcon', children: 'label', component: 'icon' }}`，对应 Figma 的 `visible`、`characters`、`mainComponent`。
- 组件的描述、`key`（`rest.components` 里的）放进 `componentSet` 的第三个参数，不进类型。
- 只导了一部分变体的组件集（`partial: true`，Golio、Untitled UI 有）在 `index.ts` 里注明"文件里共 N 个变体，只导了 M 个"。
- 主组件就在用例页面里的（`component/instances`，2 个）留在页面文件里原地写，`components/` 里照样生成 `index.ts`，指过去。

### 8.2 实例一行

```tsx
<Button
  nodeId="20:900"
  hierarchy="Primary"
  size="md"
  label="去结算"
  style={{ alignSelf: 'stretch' }}
/>
```

- 变体属性一律写出来（它决定用哪个变体）；文字、布尔属性和默认值一样时不写。换实例属性写组件：`icon={ArrowRight}`。
- 实例自己在父图层里怎么放（`style` 里的尺寸和位置、`fg-constraints`）照 §4 写在这个元素上。
- 实例根节点自己改了的字段（覆盖记录里 id 是实例自己的）直接写在这个元素上，和普通元素一样。
- 203 个用例页面上的实例属性：变体 14993 个、文字 116、布尔 76、换实例 22（实测）。页面上的文字几乎都是**覆盖**，不是文字属性。

### 8.3 覆盖

覆盖按**主组件里图层的 id** 写，不按名字（产品方向 product.md §5 第 1 条：变体里 65% 的图层名字路径重复）。名字写在行尾注释里给 agent 看：

```tsx
<Button
  nodeId="20:900"
  hierarchy="Primary"
  size="md"
  fg-overrides={{
    '10:4': { children: '去结算' }, // Label
    '10:7;5:2': { style: { color: '#FFFFFF' } }, // Icon / Glyph
  }}
/>
```

- **key**：主组件里图层的 id；嵌在里面的实例往下接，和 Figma 一样用分号（实例里图层的 id 是 `I20:900;10:7;5:2`，去掉 `I` 和实例自己的 id）。`components.ts` 的 `copyId` / `templateIdOf` 就是这么拆拼的。
- **值**：这个图层"写成元素时的属性"里和主组件不一样的那部分，写法和元素上完全一样：`style` 里的键合并进主组件的 `style`，`fg-*` 整个替换，`children` 是文字内容（可以带嵌套 `Text`）。所以覆盖不用另学一套写法。
- **嵌套实例**换了主组件或变体：`'10:7': { component: CheckIcon, variant: 'Filled' }`。
- 哪些字段算覆盖，以 `rebuildTree` 重建后的 `overrides` 为准（Figma 记的加上推断的，figma-to-tldraw tech.md §16.2）。生成器把实例里这个图层和主组件里那个图层各自写成方言属性，只写差别。
- 注释里的名字过时了没关系，解析时不看注释；检查命令可以把它们更新成主组件里现在的名字。

203 个用例页面上覆盖改的字段（实测，Figma 记的覆盖字段名，一处覆盖可能改几个）：

| Figma 覆盖字段                                                                | 处数             | 方言                                                               |
| ----------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `width` / `height`                                                            | 1439             | `style` 里的尺寸（§4.2）                                           |
| `characters` 一组（内容、分段样式、列表）                                     | 1158             | `children`                                                         |
| `primaryAxisSizingMode`、`counterAxisSizingMode`、`layoutAlign`、`layoutGrow` | 469、56、195、58 | `style` 里的尺寸方式                                               |
| `inheritFillStyleId`、`inheritTextStyleId`                                    | 453、345         | 换了样式的 token（§9）                                             |
| `paragraphSpacing`、行高一组、字体一组                                        | 309、98、96      | `fg-paragraphSpacing`、`lineHeight`、`fontFamily` / `fg-fontStyle` |
| `strokes`、`strokeWeight`、`fills`                                            | 248、146、96     | `fg-strokes`、`fg-strokeWeight`、`backgroundColor` / `fg-fills`    |
| `visible`                                                                     | 202              | `style: { display: 'none' }`                                       |
| `textAutoResize`                                                              | 192              | `style` 里写不写宽高（§6.2）                                       |
| `name`                                                                        | 83               | `name`                                                             |
| `preserveRatio`                                                               | 86               | `fg-preserveRatio`（编辑时锁比例，不影响画面）                     |

### 8.4 求值时展开实例

检查用的反方向（§13）要把实例展开成完整的图层树，才能和原快照比：复制主组件的图层，id 按 `copyId` 拼，按属性值改 `visible` / `characters` / 换主组件，再套覆盖；嵌套实例一层层往下。这和编辑引擎的 `instances.ts`（`cloneLayers`、`applyProperty`、`swapMain`）做的是同一件事，但那边操作的是画布上的图形。这里要一个只处理 Figma 节点的纯函数，阶段 6 写，以后画布从代码加载时也用它。

- **缩放过的实例**（`uniformScaleFactor`，页面上 29 个）：写 `fg-uniformScaleFactor`。展开时哪些字段要按比例缩放（尺寸、描边、字号、圆角、效果……）没核实过，记进风险。

### 8.5 主组件不在文件里的实例

库组件没权限、主组件被删了（figma-to-tldraw tech.md §16.1，175 个用例里 49 个实例）：没有组件文件可引用，写成 `Fg.Instance`，里面的图层照普通元素全部写出来，`nodeId` 用实例里的完整 id（`I…;…`）：

```tsx
<Fg.Instance
  nodeId="30:1"
  fg-componentId="99:1"
  fg-component={{ key: '…', name: 'Avatar' }}
>
  …
</Fg.Instance>
```

## 9. 样式、变量和 tokens（2026-10-31）

只有 Figma 里绑了样式或变量的值才写成 token，手填的值写原始数值，碰巧和某个 token 一样也不换（原始方案原则 4）。第一版不加"和某个 token 数值相同"的提示：这种提示会诱导 agent 把它绑上，改了设计的本意。

### 9.1 样式的值从用到它的图层反推

产品方向 product.md §5 第 4 条说插件只导出样式的名字和类型（`rest.styles`），要补导出值。实测（§15）发现**现有快照就够了**：用了某个样式的图层，它的对应字段就是这个样式的值。6 套真实稿子里定义了 203 个样式（填充 129、文字 60、效果 13、网格 1），每个样式的所有用处取值都一样（填充 124 个、文字 60、描边 55、效果 13，没有一个不一致）。所以 tokens 先从图层反推，不改插件；以后要导整份文件时，没被用到的样式没有值，那时再补导出。

> 2026-10-31 修订产品方向 product.md §5 第 4 条：原来说要补导出样式的值；对现有文件不需要。

### 9.2 写法

```ts
// tokens/index.ts
import { effectStyle, fillStyle, textStyle, variable } from '../dialect';

export const t = {
  fill: {
    'Primary/500': fillStyle('733:11640', '#7F56D9'),
    'Gray/900': fillStyle('732:11743', '#101828'),
  },
  text: {
    'Text md/Medium': textStyle('1:87', {
      fontFamily: 'Inter',
      'fg-fontStyle': 'Medium',
      fontSize: 16,
      lineHeight: 24,
    }),
  },
  effect: {
    'Shadow/sm': effectStyle('3:6', [
      {
        type: 'DROP_SHADOW',
        color: '#1018281A',
        offset: { x: 0, y: 1 },
        radius: 3,
      },
    ]),
  },
  var: {
    'FT Theme/accent': variable('VariableID:1:23', 'COLOR', {
      Light: { alias: 'FT Palette/blue/500' },
    }),
  },
};
```

- **key 就是 Figma 里的名字**，带斜杠的分组也原样留着，agent 能直接对上 Figma；类型检查保证不写错。样式重名（Figma 允许）时后面加 `#<id>`。
- 用的地方：`backgroundColor: t.fill['Primary/500']`；多层填充的样式 `fg-fills={t.fill['Gradient/Hero']}`；描边 `fg-strokes={t.stroke['Gray/200']}`；效果 `fg-effects={t.effect['Shadow/sm']}`；文字样式 `fg-textStyle={t.text['Text md/Medium']}`。
- 文字样式是一整组字段，所以用 `fg-textStyle` 整个引用，用了它的文字不再在 `style` 里写字体字段。Figma 里改了文字样式里的任何一项，整个样式就解开了，不会有"用样式、又单改一项"的情况。
- REST 的 `styles` 里 `fills` / `strokes` 和 `fill` / `stroke` 是同一个 id（实测），当成派生字段，只写一份。

### 9.3 变量和模式

- 变量（`snapshot.variables`）也进 `t.var`，key 是"集合名/变量名"。每个模式一个值，别名写 `{ alias: '集合名/变量名' }`。真实稿子里绑了变量的节点只有 8 个（产品方向 product.md §4），主要用在 6 个 `variables/*` 用例上。
- 绑定的地方和样式一样写 token：`gap: t.var['FT Spacing/gap']`。求值时只记"绑了哪个变量"（写回 `boundVariables`），值按图层所在的模式算（`figma/variables.ts` 的 `resolveVariable`），不在求值时写死（产品方向 product.md §5 第 4 条）。
- frame 自己设的模式：`fg-modes={{ 'FT Theme': 'Dark' }}`，按集合名、模式名写；从导出范围外继承来的（快照的 `inherited`）写在根上：`fg-inheritedModes`。
- 读不到的库变量（`missing`）：绑定原样写成 `fg-boundVariables`，值照快照里的写。

## 10. repo 目录和文件（2026-10-31）

```
designs/<文件名>/                     一个 Figma 文件一个 repo（不进 git，同 cases/）
├── AGENTS.md                         方言说明：怎么读、怎么改、改完怎么检查（§10.3）
├── dialect/index.d.ts                方言的类型：View、Text、Image、Fg.*、asset、componentSet……
├── tsconfig.json                     让 tsc --noEmit 能检查
├── tokens/index.ts                   样式和变量（§9）
├── components/
│   ├── _index.md                     组件目录：名字、变体数、属性、实例数
│   └── button.10-1/
│       ├── index.ts                  接口（§8.1）
│       └── component.tsx             结构
├── pages/
│   └── dashboards/                   Figma 的页面（用例的 source.page）
│       ├── _index.md                 本页目录：屏幕、尺寸、节点数、用到的组件、截图
│       └── settings.3-1/             一个用例根节点（顶层 frame 或 section）
│           ├── index.tsx             屏幕
│           ├── header.3-20.tsx       子块（超长才拆，§10.2）
│           └── expected.png          Figma 截图（用例的 expected@2x.png）
├── assets/{images,vectors}/          §7
└── .fg/manifest.json                 Figma 文件、导出时间、用例目录、nodeId → 文件
```

- **目录跟着 Figma 的结构走**（原始方案 §5）。文件名 = 名字转小写短横线 + 短 id（`:` 换成 `-`），重名不会撞。
- 每个文件导出一个没有参数的函数组件，屏幕是 `export default function Settings() { return (…); }`，子块一样，在父文件里用 `<Header />`。只为了文件不太长切开，**不是组件**，一对一属于原位置（原始方案 §6.3）。
- 主组件按 node id 在文件内去重。同一个文件的每个用例都导出了它用到的主组件，6 套稿子按页加起来 235660 个节点，去重以后是 297 个主组件和组件集、1505 个变体、24134 个节点（实测）。

> 2026-10-31 修订产品方向 product.md §4：那里说"主组件约为页面的 10 倍"，是按页重复计的。按文件去重后，组件库的节点数和页面差不多（24134 比 22245），是页面上实例外节点（6223 个）的 4 倍左右。

### 10.1 体积估计（未验证）

| 部分 | 实测                                                                                                                               | 估计的行数                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 页面 | 88 页、实例外 6223 个节点（平均每页 71 个，最多 247 个）、实例 1674 个                                                             | 每个元素 5～15 行，一页几百到两三千行 |
| 组件 | 297 个、24134 个节点；一半的组件不超过 6 个节点；最大的 "Line and bar chart" 24 个变体 2453 个节点，"Select" 60 个变体 1960 个节点 | 小的几十行，最大的上万行              |

行数要等生成器写出来再量，阶段 8 记实际结果。

### 10.2 拆文件

规则沿用原始方案 §6.3，阈值以后用真实结果调：

- 一个文件格式化后超过 1000 行，就把最大的子树拆成子块，还超就再拆下一个最大的；少于 100 行的子树不拆；frame 和有正经名字的子树优先。
- 组件也按这条拆，单位先是变体：变体拆成 `component.tsx` 旁边的 `<变体名>.<id>.tsx`。
- 一个父节点下平铺几百个小兄弟时允许超标，不硬切兄弟。
- 第一版是一次性导入，不需要原始方案的 `split.json`（记住上次怎么拆的）；要多次导入同一个文件时再加（产品方向 product.md §9 第 2 条）。

### 10.3 给 agent 读的索引

- `AGENTS.md`：方言的规矩（§3～§9 的要点：同名同义、`fg-` 就是 Figma 的字段、只写意图、组的坐标、覆盖按 id、矢量颜色暂时不生效）；读的顺序（页面目录 → 屏幕 → 子块；组件目录 → 接口 → 结构）；改完跑什么检查。
- `pages/<页>/_index.md`、`components/_index.md`：生成器按数据写，不靠 LLM。
- 原始方案 §7 的分类标签（主线 / 探索 / 标注）第一版不做：真实稿子里没有开发状态、原型连线这些可靠的信号（产品方向 product.md §4）。

## 11. 不建模的字段（2026-10-31）

快照里每个字段归到下面四类之一，归不进去的生成器报出来：

| 类                       | 怎么处理                           | 字段（203 个用例的实测）                                                                                                                                                                                 |
| ------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 写成 RN 写法             | §4～§9 的表                        |                                                                                                                                                                                                          |
| 派生的，不写，求值时重算 | 规范化时两边都去掉                 | `absoluteBoundingBox`、`absoluteRenderBounds`（矢量的进资源）、`background` / `backgroundColor`（`fills` 的旧写法）、`layoutVersion`、`styles.fills` / `strokes`、自动布局子图层的位置、包裹和填充的尺寸 |
| 默认值                   | 规范化时补上默认值再比，代码里不写 | `scrollBehavior: SCROLLS`、`complexStrokeProperties: { strokeType: 'BASIC' }`、`interactions: []`、`blendMode: PASS_THROUGH`、`visible: true`、`opacity: 1`、约束 `LEFT` / `TOP` ……                      |
| 其他                     | **按 §3.1 原样写成 `fg-<字段名>`** | `locked`（93）、`exportSettings`（56）、`layoutGrids`（45）、`isFixed`（4）、`scrollBehavior: FIXED`（4）、`preserveRatio`，以及以后 Figma 新加的字段                                                    |

最后一类不用另做原始方案 §3.3 说的 `fg-raw` 资源文件：§3.1 的命名规则本身就能装下任何字段，代码里看得见、搜得到，也不会被悄悄丢掉。这些字段多数不影响画面（导出设置、布局网格、锁定），生成器每次在报告里列出"原样写出的字段和次数"，常见的再补进正式的表。

## 12. 生成器（2026-10-31）

`apps/client/src/dialect/`（新，见 §14），命令行 `apps/client/scripts/dialect.ts`（新）：

1. **分组**：读 `cases/index.json`，按 `source.figmaFile` 把用例分到各个文件，每个用例读 `snapshot.json`。
2. **规范化**：`rebuildTree` 重建实例；`withVariableModes` 把模式写进节点、文字的变量绑定挪进 `style`（figma-to-tldraw tech.md §21.2、§21.4）；补默认值、去掉派生字段（§13.2）。
3. **收集共享的东西**：主组件去重；从图层反推样式的值（§9.1）；变量。
4. **转成中间树**：每个节点按 §3～§9 变成元素；实例按 §8 只留属性和覆盖。遇到 §11 归不进去的字段记进报告。
5. **分文件**（§10.2）、写索引、拷资源。
6. **打印**：中间树打印成 TSX，`oxfmt` 格式化（和仓库同一份 `.oxfmtrc.json`）。

**同样的输入，生成的文件逐字节一样。** 属性顺序固定（`nodeId`、`name`、组件属性、`style`、`fg-*` 按字母、`fg-overrides`），`style` 里的键按 §4～§6 表里的顺序，对象的 key 排序，数字按 §5.1。这样重新生成时 git diff 里只有真正变了的地方。

**报告**：每个文件生成了几个页面、组件、文件、多少行；原样写出的字段和次数（§11）；连不上主组件的实例；警告（沿用快照里的 `meta.warnings`）。

## 13. 求值器和往返比较（2026-10-31）

### 13.1 方言的语法

解析器只认下面这些，其他写法报错，带文件名和行列号：

| 文件                 | 允许                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 页面、子块、组件结构 | `import`（相对路径）；一个 `export default function X() { return (JSX); }`；JSX 元素和属性；属性值是字面量（字符串、数字、布尔、对象、数组）、token（`t.fill['…']`）、`asset('…')`、导入的组件名；JSX 里的字符串 `{'…'}`；注释 |
| 组件接口 `index.ts`  | `interface` / `type`（只给 tsc 看，解析器跳过）；`export const X = componentSet<…>('id', {…})` 或 `component<…>(…)`                                                                                                            |
| `tokens/index.ts`    | `export const t = { … }`，值是 `fillStyle(…)`、`textStyle(…)`、`effectStyle(…)`、`variable(…)` 和字面量                                                                                                                        |

不允许 `.map()`、条件、三元、变量、自己写的函数调用（原始方案原则 5）。以后要支持交互时按产品方向 product.md §7 的几种固定写法加。

**解析器选型（阶段 0 定）**：

| 方案            | 结论                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `oxc-parser`    | 倾向：仓库的 lint 和格式化已经用 Oxc，速度快、带位置信息；能不能在浏览器里跑（路线第 4 步要）未验证 |
| `@babel/parser` | 备选：纯 JS，浏览器和 Node 都能跑，带位置信息，久经考验                                             |
| `typescript`    | ❌ 体积大，只拿来做类型检查（`tsc --noEmit`）                                                       |

### 13.2 规范化和"一样"的定义

原快照和"代码变回来的快照"都过同一个 `normalize`（`dialect/normalize.ts`，新），再逐字段比：

1. 实例用 `rebuildTree` 重建，覆盖记录完整。
2. 去掉 §11 的派生字段，补上默认值。
3. 只比"意图"：自动布局子图层的位置、包裹和填充的尺寸、组的框不比（§2）；不是自动布局的父图层里子图层的位置和旋转比，按 §4.5 换算后的 `left` / `top` / `transform`。
4. 分段样式的覆盖号按出现顺序重新编号。
5. 数字和颜色按 float32 比；旋转角度差 1e-6 度以内算一样。

比较结果列出每个不一样的地方：用例、node id、字段路径、两边的值。**目标是 203 个用例零差别。**

### 13.3 和截图对比的关系

逐字段一样，说明代码把 Figma 的意图全记下来了；画出来是否和 Figma 一样，还取决于重排（§2）。两件事分开测：

- 逐字段往返在 Node 里跑（`roundtrip.test.ts`），快，每次改转换都跑。
- 重排后的还原度在阶段 0 用现有的 `compare.ts` 测一次，不依赖方言。
- 两个都过，从代码画出来的结果就和 Figma 一样。真正"从代码加载到画布再截图"是路线第 4 步的事，那时补上端到端的截图对比。

## 14. 代码放在哪、和现有代码的关系（2026-10-31）

| 方案                                                          | 结论                                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/client/src/dialect/` + `apps/client/scripts/dialect.ts` | ✅ 建议先这样：直接复用 `figma/types.ts`、`components.ts`、`variables.ts`；跑法和 `compare.ts`、`check-components.ts` 一样（`npx tsx`）；测试用 client 现有的 vitest；不算架构改动                                                 |
| 新包 `packages/dialect/`                                      | 以后再说：`pnpm-workspace.yaml` 已经包含 `packages/*`，但包不能反过来引用 `apps/client` 里的 Figma 模型，要先把 `types.ts`、`components.ts`、`variables.ts` 一起挪进包。属于架构改动，要用户点头（产品方向 product.md §9 第 4 条） |

计划的文件（都是新的）：

| 文件                                   | 内容                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `dialect/model.ts`                     | 中间树的类型                                                           |
| `dialect/from-snapshot.ts`             | 快照 → 中间树（§3～§9 的映射）                                         |
| `dialect/print.ts`、`dialect/parse.ts` | 中间树 ↔ TSX                                                           |
| `dialect/to-snapshot.ts`               | 中间树 → 快照，含展开实例（§8.4）、查 token                            |
| `dialect/normalize.ts`                 | §13.2                                                                  |
| `dialect/repo.ts`                      | 分组、去重、分文件、索引、AGENTS.md                                    |
| `dialect/runtime/`                     | 拷进生成 repo 的 `dialect/index.d.ts`、`tsconfig.json`、AGENTS.md 模板 |
| `scripts/dialect.ts`                   | `import`（生成）和 `check`（解析 + 求值 + 和原快照比 + tsc）           |

现有代码这一步都不改：`to-shapes.ts`、引擎、编辑器照旧从快照加载。`components.ts` 的 `rebuildTree`、`copyId`、`templateIdOf`、`nodeFieldsFor`，`variables.ts` 的 `withTextBindings`、`resolveVariable` 直接调用。

## 15. 字段统计的方法（2026-10-31 实测）

一次性的 Python 脚本（会话临时脚本，没进仓库；阶段 1 改写成 `apps/client/scripts/dialect-census.ts`），读 `cases/index.json` 里 203 个用例的 `snapshot.json`：

- **页面**：从 `rest.document` 往下数所有节点（含实例里的图层），共 22810 个；真实稿子 88 个用例 22245 个。
- **字段出现次数**：节点上的每个键、`style` 里的每个键；枚举字段数每个取值。"看得见的描边"是 `strokes` 里有一层 `visible` 不是 false。
- **覆盖**：最外层实例的 `overrides[].overriddenFields`，是导出时的原始记录，不是重建后补全的。
- **主组件**：只看真实稿子，同一个 Figma 文件里按 node id 去重。
- **样式的值**：对每个样式 id，收集所有用到它的图层的对应字段（填充看 `fills`，描边看 `strokes`，效果看 `effects`，文字看 `style` 里的字体字段，跳过分段样式的文字），比较是不是只有一种取值。
- **颜色**：每个 r、g、b 乘 255 四舍五入再除回去，和原值按 float32 比。
- **组的框**：`GROUP` 的 `absoluteBoundingBox` 和子图层 `absoluteBoundingBox` 的并集比，差 0.01 以内算一样。

## 16. 风险

| 风险                                                                | 应对                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------- |
| 只写意图以后要整页重排，还原度可能下降（§2），没测过                | 阶段 0 先测；掉得多就加排版缓存                      |
| 41 个组的框不等于子图层的并集（§4.4），规则没找到                   | 阶段 0 看截图差多少；不行就给这些组写框              |
| 缩放过的实例展开时要缩放哪些字段没核实（§8.4）                      | 阶段 6 拿 29 个页面上的实例对着快照找规则            |
| `fg-` 照 REST 命名（§3.1）是建议，用户可能要自己起名                | 阶段 0 先手写三个样例给用户看，定了再写生成器        |
| 文字的 `letterSpacing` 只有像素，设计师原来设的百分比丢了           | 导出时就没了，方言管不了；要的话插件补导出           |
| 统计和估算用的是 UI kit，产品稿里覆盖、样式、绝对定位的比例会不一样 | 拿到真实产品稿时重跑统计脚本                         |
| 生成的代码 agent 到底好不好用，这一步不测                           | 路线第 6 步专门比（产品方向 product.md §11 第 4 条） |
| 矢量的颜色写在代码里但现在不生效（§7.2），agent 改了看不到变化      | AGENTS.md 写明；路线第 2 步按几何数据画以后解决      |
| oxfmt 格式化 JSX 时可能挪注释的位置（覆盖后面的名字注释）           | 阶段 1 实测；挪了就把名字放进 key 旁边的固定位置     |
