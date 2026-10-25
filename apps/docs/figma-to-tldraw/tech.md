# Figma 还原到 tldraw：技术实现

> 相关：[模块说明](README.md) · 施工计划 [`docs/施工计划.md`](../../../docs/施工计划.md)

## 1. 链路和快照格式（2026-10-24）

```
Figma 插件（apps/figma-plugin/）
   │  生成测试用例 → 导出 zip → 解压（或用 import-cases 合并，§9.2）成仓库根目录的 cases/
   ▼
/canvas 页面（apps/client/src/pages/canvas.tsx）
   │  load.ts 读 cases/ → to-shapes.ts 把节点树拆成图形 → editor.createShapes
   ▼
四种自定义图形（apps/client/src/figma/shapes/）
   │  按 Figma 样式画
   ▼
对比脚本（apps/client/scripts/compare.ts）
      Playwright 截图 → pixelmatch 对比 expected@2x.png → reports/fidelity/
```

### 1.1 cases/ 目录

```
cases/
  index.json                 用例列表：name、dir、width、height、fonts、warnings
  <分类>/<用例名>/
    snapshot.json            { meta, rest, svgs, transforms }
    expected@2x.png          Figma 导出的 2 倍图
    images/<hash>.png        用到的图片
```

`cases/` 和 `reports/` 都不提交进 git（图片和截图体积大），在 `.gitignore`、`.oxlintrc.json`、`.oxfmtrc.json` 里都排除了。开发服务器通过 `apps/client/vite-plugins/serve-dir.ts` 的 `serveDir(前缀, 目录)`（在 `vite.config.ts` 里注册）把 `cases/` 提供成 `/cases/...`、`reports/` 提供成 `/reports/...`，只认目录里面的文件，路径里带 `..` 跳出去的、指向文件夹的一律 404。

> 2026-10-24 修订：原来是只管 `cases/` 的 `serve-cases.ts`，展示页（§10）要读对比报告，改成通用的 `serveDir`，多挂一个 `/reports/`。

`/canvas` 页面（2026-10-24）：左侧是按分类分组的用例列表，当前用例写在网址里（`/canvas?case=fill/solid`）；顶部工具条可以把 `expected@2x.png` 按 frame 尺寸盖在画布上，"半透明"用 50% 透明度，"差异"用 `mix-blend-mode: difference`（完全一样的地方是黑色）。原图放在 tldraw 的 `OnTheCanvas` 层，跟着镜头一起移动缩放。没有 `case` 参数时显示 `fixtures/hello.json`。

### 1.2 snapshot.json

| 字段         | 内容                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `rest`       | `exportAsync({ format: "JSON_REST_V1" })` 的原始结果，节点树在 `rest.document`                                                               |
| `svgs`       | `{ [nodeId]: svg 字符串 }`：VECTOR、BOOLEAN_OPERATION、STAR、POLYGON、LINE、ELLIPSE 单独导出的 SVG。布尔运算整体导出一个，不再导出它的子节点 |
| `transforms` | `{ [nodeId]: { m, w, h } }`：插件 API 的 `absoluteTransform`（2×3 矩阵）和节点本身的宽高（2026-10-24 加，见 §4.2）                           |
| `meta`       | 用例名、尺寸、字体、`images`（`{ [hash]: 相对路径 }`）、`filteredImages`（带滤镜的图片渲染好的版本，见 §6.8）、`imageSizes`、`masks`、警告   |

2026-10-24 拿到真实数据后确认的事：

- 图片填充的 `imageRef` 就是 `meta.images` 的 key。
- `svgs` 的 key 和节点树里的 `id` 一样；每个导出了 SVG 的节点都有 `absoluteRenderBounds`。
- REST 格式里**没有** `size` 和 `relativeTransform`，只有 `rotation`（弧度，正负号和 Figma 界面相反）；旋转节点的 `absoluteBoundingBox` 是旋转后的外接框。所以插件额外导出了 `transforms`。
- 多边形在 REST 格式里叫 `REGULAR_POLYGON`（插件 API 里叫 `POLYGON`）。
- 蒙版图层单独导出 SVG 会失败，插件改为导出它的 `fillGeometry`（见 §5.2）。

## 2. tldraw 3.x 的限制（2026-10-24）

在 3.15.6 的源码里查到的，决定了后面的做法：

- **图形在网页里是平铺的。** 每个图形是 `.tl-shapes` 下面一个兄弟 `div.tl-shape`，父子关系只在数据里（`parentId`）。没法靠嵌套 `div` 加 `overflow: hidden` 裁剪。
- **只有自带的 `frame` 能裁剪子图形。** `@tldraw/editor` 的 `Editor._getShapeMaskCache` 写死了 `isShapeOfType(…, "frame")`。3.x 没有 `getClipPath`、`BaseFrameLikeShapeUtil`（4.x 才有）。
- **子图形透明度 = 各级祖先透明度相乘**（`Editor.getRenderingShapes` 里的 `opacity *= shape.opacity`），分别作用在每个图形的 `div` 上，不是整组合成后再变透明。
- **每个 `.tl-shape` 都带 `transform`，自成一个层叠上下文。** 写在图形里面的 `mix-blend-mode` 只能和这个 `div` 自己的内容混合，所以混合模式要加在 `.tl-shape` 这一层（见 §6.6）。
- 没有 license key 时画布右下角有 "MADE WITH TLDRAW" 水印，截图时要避开（见 §7）。

## 3. 自定义图形（2026-10-24）

| tldraw 图形    | 对应的 Figma 节点                                         | 怎么画                                         |
| -------------- | --------------------------------------------------------- | ---------------------------------------------- |
| `figma-frame`  | FRAME、COMPONENT、COMPONENT_SET、INSTANCE、SECTION、GROUP | 填充、描边、圆角、阴影；本身不裁剪子图形（§5） |
| `figma-rect`   | RECTANGLE、ELLIPSE                                        | 填充（含图片）、描边、圆角、阴影               |
| `figma-text`   | TEXT                                                      | 字体、字号、行高、颜色、对齐、混合样式         |
| `figma-vector` | VECTOR、BOOLEAN_OPERATION、STAR、REGULAR_POLYGON、LINE    | 直接放插件导出的 SVG                           |

- 代码在 `apps/client/src/figma/shapes/`，四个 ShapeUtil 共用 `base.tsx` 里的 `FigmaShapeUtil`。
- props 只放这个图形自己的数据：`w`、`h`、`node`（去掉 `children` 的 Figma 节点）、`svg`（只有 `figma-vector` 用）、`images`（`imageRef` → 图片地址）、`mask`（被哪个蒙版遮住，§5.2）。
- 渲染内容 `pointer-events: none`，选中和拖动交给 tldraw。这一版每个图层只能选中和移动，关掉了缩放和旋转手柄。
- 圆弧（ELLIPSE 带 `arcData`）用 `div` 画不出来，改成 `figma-vector` 用插件导出的 SVG。

## 4. 节点树拆成图形（2026-10-24）

`apps/client/src/figma/to-shapes.ts` 的 `snapshotToShapes(snapshot, opts)`，纯函数，输入快照，输出 `{ shapes, warnings }`：

1. 从 `rest.document` 递归，跳过 `visible: false` 的节点和它的子节点。
2. 按 §3 的表决定图形类型；不认识的类型跳过并记一条警告。
3. 图形 id 由节点 id 生成（`figma:<caseDir>:<nodeId>`），子节点的 `parentId` 指向父节点的图形。
4. 上下层：同一个父节点下按 `children` 的顺序排，Figma 里第一个子节点在最下面。自动布局设了 First on top 时反过来（§4.3）。
5. 位置见 §4.2。

### 4.1 透明度

图形的 `opacity` = 节点的 `opacity`（REST 里没有就是 1）。tldraw 会自己乘上祖先的透明度（§2），所以不要再手动乘。

例外（2026-10-24，第一份报告发现）：`figma-vector` 的 `opacity` 固定是 1。Figma 导出的 SVG 已经把节点自己的透明度写进去了（比如 `<circle opacity="0.5">`），图形上再乘一次就变成 0.25。混合模式不会写进 SVG，还是由图形自己处理（§6.6）。

组透明度（2026-10-24 补）：Figma 的组 / frame 透明度是"先把子节点画在一起，再整体变淡"，tldraw 是"每个子图形各自变淡"。子节点互相重叠时，下层会从上层透出来（`container/group-opacity` 右边那组）。

不改架构的补法（`clip.ts`）：如果上层兄弟是**完全不透明的简单形状**，下层被它盖住的部分在"先画在一起"时本来就看不见，那就把这块从下层裁掉，各自变淡后结果和 Figma 一样。具体是：图形往上找祖先，遇到透明度小于 1 的 frame / 组，就看自己（或自己所在的那支祖先）之后的兄弟；兄弟满足下面条件时，在裁剪里加一条 `path(evenodd, '<很大的矩形> <兄弟轮廓>')`，也就是"除了兄弟轮廓以外都保留"。

"完全不透明的简单形状"指：

- 图形和节点的透明度都是 1，没有蒙版，混合模式是普通，没有可见的效果；
- 描边没有或只在内侧（不会超出轮廓）；
- 有一层可见的、颜色和透明度都是 1 的纯色填充；
- 形状是矩形、裁剪内容的 frame，或者整圆、没有内径的椭圆（导出成 SVG 的也算）。

注意 `editor.getShapeAncestors()` 返回的顺序是**从根往下**，往上找要先反转。

还管不了的情况：上层兄弟半透明、带渐变 / 图片 / 阴影、是任意矢量或文字时，重叠部分仍然会透出来。要完全一致只能把整个子树画进一个图形，属于架构改动，没做。

### 4.2 位置和旋转

tldraw 子图形的 `x`、`y`、`rotation` 是相对父图形的局部坐标。做法是先算出每个图形想要的**页面变换矩阵**，再换算成相对父图形的：

```
局部矩阵 = 父图形页面矩阵⁻¹ × 自己的页面矩阵
x, y = 局部矩阵的平移；rotation = atan2(b, a)
```

- 矩阵统一写成 `[[a, c, tx], [b, d, ty]]`，和插件 API 的 `absoluteTransform` 一样（`types.ts` 的 `Matrix2x3`，工具函数在 `matrix.ts`）。
- 最外层 frame 放在画布原点：所有页面矩阵都先减去它的平移。
- frame / rect / text：页面矩阵 = `transforms[id].m`，宽高 = `transforms[id].w/h`。插件 API 的 `relativeTransform` 遇到父节点是 GROUP 或布尔运算时不是相对直接父级的，所以统一用 `absoluteTransform` 自己算。
- vector：插件导出的 SVG 已经是转好角度的样子，大小等于 `absoluteRenderBounds`。所以页面矩阵 = 平移到 `absoluteRenderBounds` 的左上角、不旋转，宽高 = `absoluteRenderBounds` 的宽高。
- 快照里没有 `transforms`（比如手写的测试数据）时，退回用 `absoluteBoundingBox`，不旋转。

### 4.3 First on top 叠放（2026-10-24，真实稿子考试发现）

自动布局的 frame 可以把叠放顺序设成 "First on top"，快照里是 `itemReverseZIndex: true`：`children` 里第一个画在最上面，和平常相反。插件生成的 79 个用例里没有，Gemini 稿子的 21 个 Stacked card 实例用了它，没处理时卡片背景盖住了上面的文字和图标。

`to-shapes.ts` 的 `visit()`：遇到这个字段就把 `children` 倒过来，再按"从下往上"分配 tldraw 的 `index`。蒙版也按倒过来以后的顺序算，也就是裁剪画在它上面的兄弟；First on top 里放蒙版的情况没有用例，未验证。

## 5. 裁剪和蒙版（2026-10-24）

tldraw 3.x 不让自定义图形裁剪子图形（§2），所以反过来：**子图形自己裁**。

### 5.1 frame 裁剪

渲染每个图形时：

1. 找出所有 `clipsContent: true` 的祖先 `figma-frame`。
2. 把每个祖先的形状（圆角矩形）用 `自己页面矩阵⁻¹ × 祖先页面矩阵` 换算到自己的坐标里，生成 SVG 路径。
3. 一层祖先套一层 `div`，每层 `clip-path: path(...)`。几层嵌套的 `div` 坐标系相同，效果就是几个形状取交集。

在组件里通过 `useEditor()` 读祖先的页面矩阵，tldraw 会自动追踪，拖动父图形时子图形会重新计算。代码在 `apps/client/src/figma/clip.ts`。

路径怎么换算（`geometry.ts`）：圆角矩形的四个角和椭圆都用三次贝塞尔曲线近似（系数 0.5523），这样所有轮廓都只有 M、L、C、Z 几种命令；`transformPath()` 把一条绝对坐标的路径（Figma 写出来的路径只用 M、L、H、V、C、Q、Z）的每个点乘上矩阵后重新输出。CSS 的 `clip-path: path()` 不接受变换，只能把矩阵算进路径里。

### 5.2 蒙版

Figma 的蒙版图层（`isMask: true`）遮住同一个父节点里排在它上面的兄弟图层。转换时给这些兄弟图层的 props 记上 `mask`（蒙版图层的图形 id），渲染时用蒙版图层的形状做 `clip-path`，和 §5.1 用同一套代码。蒙版图层本身不画。

蒙版形状的来源：插件导出的 `meta.masks[id]`（`fillGeometry` 的路径，节点自己的坐标系）。

## 6. 样式怎么画（2026-10-24）

代码在 `apps/client/src/figma/paint.tsx`（填充、描边）、`effects.ts`（阴影、模糊）、`shapes/figma-text.tsx`（文字）。

### 6.1 填充

一个节点的多层填充画成一叠绝对定位的层，外面套一个按节点形状裁剪的容器（圆角或椭圆，`overflow: hidden`）。

| 填充类型                | 画法                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| SOLID                   | `div` 背景色，`opacity` = 填充的 `opacity`                                                                                             |
| GRADIENT_LINEAR、RADIAL | 一个 SVG：`gradientUnits="userSpaceOnUse"`，`gradientTransform` = 渐变空间到像素的矩阵。渐变的拉伸和倾斜和 Figma 完全一致              |
| GRADIENT_ANGULAR        | 用同一个矩阵变换一个 `div`，里面是 CSS `conic-gradient`                                                                                |
| GRADIENT_DIAMOND        | 同上，`div` 分成四个象限，每个象限一个斜向的 `linear-gradient`                                                                         |
| IMAGE                   | `div` 背景图：FILL = `cover`，FIT = `contain`，TILE = 按 `meta.imageSizes × scalingFactor` 平铺，CROP = 按 `imageTransform` 放大和偏移 |

渐变矩阵（`paint.tsx` 的 `gradientMatrix()`）：REST 里给的是 `gradientHandlePositions`，三个控制点 p0、p1、p2，坐标是节点归一化坐标（左上 (0,0)，右下 (1,1)）。乘上节点宽高换成像素后，渐变空间 (s, t) 到像素的矩阵是 `p0 + s·(p1−p0) + t·(p2−p0)`：

- 线性：颜色沿 s 从 0（p0）到 1（p1）变化，等色线平行于 p2−p0。SVG 里写 `x1=0 x2=1`，`gradientTransform` 用这个矩阵。2026-10-24 用 `fill/linear-gradient-rotated` 的数据验算过：插件里设的 `gradientTransform` 求逆后正好得到 REST 里的三个点。
- 径向、角度、菱形：以 p0 为圆心，p1−p0 和 p2−p0 是两条半轴，也就是渐变空间里以原点为圆心的单位圆。径向在 SVG 里写 `cx=0 cy=0 r=1`。
- 角度和菱形用 CSS 画：一个 `div` 代表渐变空间里 [−8, 8] 的正方形（每单位 100px），用上面的矩阵乘上缩放和平移后作为 CSS `transform`。角度用 `conic-gradient(from 90deg)`，从 p1 方向开始顺时针转；菱形分成四个象限，每个象限一个 45° 方向的 `linear-gradient`，颜色位置按 |s|+|t| 换算。
- 图片的 STRETCH（Figma 界面上的 CROP）：`imageTransform` 把节点归一化坐标映射到图片归一化坐标，所以图片框在节点里的位置是 `缩放(w,h) × imageTransform⁻¹ × 缩放(1/w,1/h)`，作为 CSS `transform` 加在一个 w×h、`background-size: 100% 100%` 的 `div` 上。

### 6.2 描边

矩形、椭圆、frame 的描边用一个 `overflow: visible` 的 SVG 画，按对齐方式调整几何：

| 对齐    | 画法                                 |
| ------- | ------------------------------------ |
| INSIDE  | 矩形向内缩 w/2，圆角 r − w/2，线宽 w |
| CENTER  | 矩形不变，圆角 r                     |
| OUTSIDE | 矩形向外扩 w/2，圆角 r + w/2         |

渐变描边用 §6.1 的渐变。四边粗细不同（`individualStrokeWeights`）用 CSS `border` 分别设四边。线帽、拐角按 `strokeCap`（NONE / ROUND / SQUARE）和 `strokeJoin`（MITER / ROUND / BEVEL）设。

**tldraw 的全局样式会改线帽**（2026-10-24）：`tldraw.css` 给 `.tl-html-container` 设了 `stroke-linecap: round; stroke-linejoin: round`，会继承到图形里所有的 SVG，包括 Figma 导出的矢量图（Figma 遇到默认的平头、尖角时不写这两个属性）。所以 `FigmaShapeContainer` 在 `HTMLContainer` 上把它们重置回 SVG 默认的 `butt` / `miter`（`stroke/cap-join` 0.18% → 0.00%）。

**虚线**（2026-10-24）：Figma 画矩形虚线时，把轮廓拆成四条直边和四个圆角，每一段单独排虚线：

- 每段放整数个周期（段长 ÷ 周期四舍五入，至少 1 个），实线和空白按比例拉伸或压缩到正好铺满这一段。比如 240×120、圆角 16、4px 内描边、`[16, 8]` 的虚线，上边 208px 放 9 个周期（周期变成 23.1px），左边 88px 放 4 个（22px）。
- 每段都从半个实线开始、以半个实线结束，所以拐角处总有一整段实线跨过去。

SVG 的 `stroke-dasharray` 只会从起点一直往下重复。所以矩形虚线按 `geometry.ts` 的 `roundedRectPieces` 拆成几段 `<path>`，每段用自己算出来的 `stroke-dasharray` 和 `stroke-dashoffset`（= 第一个实线长度的一半）。椭圆按整个周长放整数个周期（`stroke/dashed` 1.09% → 0.00%）。

### 6.3 阴影和模糊

| 效果            | 画法                                                        |
| --------------- | ----------------------------------------------------------- |
| DROP_SHADOW     | `box-shadow: x y radius spread color`；文字用 `text-shadow` |
| INNER_SHADOW    | `box-shadow: inset …`                                       |
| LAYER_BLUR      | `filter: blur(radius / 2)`                                  |
| BACKGROUND_BLUR | `backdrop-filter: blur(radius / 2)`                         |

矢量节点导出的 SVG 已经带了阴影和模糊，不再加。

背景模糊的那一层不能放在 §5 的 `clip-path` 包装层里面（2026-10-24，第一份报告发现）：浏览器规定，带 `clip-path`、`filter`、`opacity < 1`、`mask`、`mix-blend-mode` 的元素是"背景根"，它里面的 `backdrop-filter` 只能模糊到这个元素里面画的东西，看不到下面的其他图形。所以 `FigmaShapeContainer` 把背景模糊层（`BackdropBlur`）放在裁剪包装层外面，最近的那个裁剪形状直接写在这一层自己的 `clip-path` 上（元素自己的 `clip-path` 不影响它看到的背景）。限制：有好几层裁剪时，背景模糊层只按最近的一层裁；图形自己带透明度或混合模式时，`.tl-shape` 本身就成了背景根，模糊还是会失效。

### 6.4 文字

- 字体：Inter 和 Noto Sans SC 用 npm 的 `@fontsource` 包加载，和 Figma 用同样的字重。代码在 `apps/client/src/figma/fonts.ts`。
- Red Hat Display（2026-10-24，真实稿子考试补）：`@fontsource/red-hat-display` 5.3.0 的 400 和 700。常规字重宽度和 Figma 一样（28px 的 "Built with Material" 216.4px，Figma 217px）；粗体窄一点（"Unofficial Recreation" 272.2px，Figma 279px）。试过 4.0.0、4.5.12 和可变字体版 `@fontsource-variable/red-hat-display`，量出来都是 272.2px，没找到和 Figma 一样的版本，先接受。
- **Inter 必须用 3.x 版本**（2026-10-24，第一份报告发现）：Figma 用的是 Inter 3.19，新版 Inter 4（`@fontsource/inter` 5.x）的字宽不一样，24px 的 "The quick brown fox jumps" 宽 306.9px，Figma 是 305px，3.19 量出来是 304.6px。所以锁定 `@fontsource/inter@4.5.15`（里面是 Inter 3.19）。也试过 Inter 4 的光学尺寸（`opsz`），24px 时只有 292.5px，更不对。
- Inter 3.19 的字体包没有静态斜体。Figma 的 Inter Italic 是正体倾斜 10°，所以斜体改用同一个包里带倾斜轴的可变字体 `InterVariable`，CSS 写 `font-style: oblique 10deg`。
- 行高（2026-10-24 改过两次）：
  - 单位是 `INTRINSIC_%`（自动）时，Figma 实际用的是**四舍五入到整像素**的行高：16px 的 Inter 在 REST 里是 19.36，但 5 行的段落框高是 95 = 5 × 19；所有单行文字的框高也都是取整后的行高。所以自动行高 = `round(lineHeightPx ÷ 基础字号 × 这段的字号)`（`text/wrap` 0.93% → 0.02%）。
  - 同一段里字号不同的部分各自算行高，写在每个 `<span>` 上，大字会撑高所在的行（`text/mixed-styles` 2.15% → 0.57%）。
  - 比基础行高大的那段只往上撑，不往下撑（2026-10-24 补，`text/mixed-styles` 0.57% → 0.00%）。依据：这个用例 20px 的字里夹了一个 32px 的 "Big"，两行，自动高度。按 CSS 的规则第一行是 39px（大字的行高），第二行 24px，一共 63；Figma 的框高却是 60，第二行的基线也比 CSS 高 3px。60 = 36 + 24，36 正好是"大字基线以上的高度 31 + 普通字基线以下的高度 5"。做法（`figma-text.tsx` 的 `runLineStyle`）：把大字那段的 `line-height` 改成"它基线以上的高度 + 基础样式基线以下的高度"，这样它不会把行往下撑；CSS 的半行距是上下对称的，所以再用 `vertical-align` 把这段抬到上沿对齐的位置，最后用 `position: relative; top` 把字形挪回原来的基线。只有这一个用例有混合字号，大字在最后一行、或一行里有多种大字号时是不是也这样，还没验证过。
  - `PIXELS` 直接用 `lineHeightPx`；`FONT_SIZE_%` 按字号等比例算，不取整（用例里都是整数，没法确认 Figma 取不取整）。
  - 样式覆盖表里自己写了 `lineHeightPx` 的那段，用它自己的值。
- 下划线、删除线（2026-10-24）：粗细用字体文件里写的值（Inter 是 0.068em，22px 时 1.5px；浏览器默认是字号的 1/10，22px 时 2.2px）。位置两边的理解不一样：
  - 下划线：Chrome 把线的**上边缘**放在字体 `post` 表的下划线位置，Figma 再往下半个线粗。所以用 `text-underline-position: from-font` 再加 `text-underline-offset: 线粗 / 2`。
  - 删除线：Chrome 把线的**中线**放在 OS/2 表的删除线位置，Figma 把**上边缘**放在那里。CSS 没有删除线的偏移属性，所以不用 `line-through`，改用背景画：`linear-gradient(currentColor, currentColor)` 不平铺，高 = 线粗，纵向位置 = Chrome 的上沿 − 删除线位置（都按 em 算；行内元素的背景从字体上沿开始画，跨行时每行一样）。
  - 两种字体的数值记在 `FONT_METRICS` 里（Inter：下划线位置 464、粗 192、删除线位置 922、粗 192，UPM 2816；Noto Sans SC：125 / 50 / 325 / 50，UPM 1000）。不认识的字体退回浏览器默认画法（`text/decoration-case` 0.23% → 0.00%）。
- **基线取整**（2026-10-24）：同一段文字，Chrome 和 Figma 的基线会差 1px，和字号有关（第一份报告里 11、12、13、14、18、22、28px 都偏高 1px，10、15、16、20、24px 对齐）。统计了 79 个用例里全部单行文字后找到的规律：
  - Chrome：先把字体的上沿（ascent）和下沿（descent）分别四舍五入成整**设备像素**，行高减去这两个数再除以 2、**向下取整**，加上取整后的上沿，就是基线离文本框顶部的距离（设备像素，除以 `devicePixelRatio` 换回 CSS 像素）。最早是在 Playwright 模拟的 2 倍屏下找到的规律，那时 Chrome 按 CSS 整像素取整；改成真实 2 倍屏截图以后（§7）把屏幕倍数加进公式，同样对得上。
  - Figma：基线 = 上沿 × 字号 + (行高 − (上沿 + 下沿) × 字号) ÷ 2，自动高度的文本框还要加上"框高 − 行数 × 行高"（框高取整留下的零头，不超过 0.5px）的一半，最后**四舍五入到整像素**（导出 2 倍图时也是按 1 倍的整像素对齐）。
  - 两者的差用 `position: relative; top` 补到文字上，只对顶部对齐的文字做。
  - **两边用的字体高度数据不一样**：Figma 用字体 OS/2 表里的 typo 上沿 / 下沿，macOS 上的 Chrome 用 hhea 表。Inter 3.19 两组一样（2728 / 680，UPM 2816）；Noto Sans SC 差很多（typo 880 / 120，hhea 1160 / 288，UPM 1000），所以 `figma-text.tsx` 里按字体分别记两组（`FONT_METRICS`），不认识的字体不补。Noto Sans SC 的自动行高在 Figma 里是 1.2 倍字号，也不是按 hhea 算的 1.448 倍（`text/cjk-mixed` 1.77% → 0.00%）。
- `textAutoResize` 为 `WIDTH_AND_HEIGHT` 时不换行（`white-space: pre`），其他情况按节点宽度换行。
- 垂直对齐用 flex 的 `justify-content`。
- 混合样式：按 `characterStyleOverrides` 把文字切成几段，每段套 `styleOverrideTable` 里的样式。
- 段落间距：每个换行符切一段，段与段之间加 `paragraphSpacing`。
- 截断：`maxLines` 用 `-webkit-line-clamp`；单行用 `text-overflow: ellipsis`。

### 6.5 圆角

`cornerRadius` 或 `rectangleCornerRadii`（四个角不同）→ CSS `border-radius`。相邻两个圆角之和超过边长时，CSS 会把所有圆角按同一比例缩小；`geometry.ts` 的 `clampRadii()` 用同样的规则算 SVG 描边和裁剪路径，保证三处一致。Figma 遇到超大圆角也是缩小（`radius/pill-clamped` 用例）。

### 6.6 混合模式

节点的 `blendMode` 写在图形内容的 `data-figma-blend` 属性上，全局 CSS 用 `.tl-shape:has(> [data-figma-blend=…])` 把 `mix-blend-mode` 加到外层 `div.tl-shape` 上（原因见 §2）。

### 6.7 文字的渐变填充（2026-10-24，真实稿子考试补）

Figma 的文字可以整段或部分字符用渐变填充（Gemini 稿子的 "Hello, Team"，在 `styleOverrideTable` 里）。渐变的位置是相对**整个文字框**算的，不是相对那几个字。

做法（`figma-text.tsx` 的 `TextContent`）：

1. 一段文字的填充里没有纯色、有线性或径向渐变时，算"渐变文字"（`gradientFill()`），这段的 `color` 设成透明。
2. 文字框里有渐变文字时，在上面再叠一层一模一样的文字：外层 div 和文字框一样大，背景是渐变图，`background-clip: text` 让背景只露在字形里；这一层里不是渐变的文字设 `visibility: hidden`，排版不变，但不参与裁剪，所以只有渐变文字露出渐变。
3. 渐变图是 `paint.tsx` 的 `gradientImageCss()` 生成的 SVG 图片（data URL），和 §6.1 的 `SvgGradientDef` 用同一个变换矩阵，所以斜着、拉伸过的渐变也对得上。

为什么叠一层，不直接在原来那层上加 `background-clip: text`：那样背景会裁到所有文字上，纯色文字盖在渐变上面，字的边缘（抗锯齿那一圈半透明像素）会透出一点渐变色。

还没做的：角度渐变和菱形渐变的文字（`gradientImageCss` 返回空，这段文字会看不见）、图片填充的文字、同一个文字框里有两种不同的渐变（只用第一种）。

### 6.8 图片滤镜（2026-10-24，真实稿子考试补）

Figma 的图片填充可以调 7 种滤镜（`filters`）：曝光 `exposure`、对比度 `contrast`、饱和度 `saturation`、色温 `temperature`、色调 `tint`、高光 `highlights`、阴影 `shadows`，取值 -1～1。Gemini 稿子的背景大图和 logo 用了它，没处理时缩略图差 41.54%。

**做法：导出时让 Figma 把加了滤镜的图片渲染一份，渲染器直接用这份图。**

| 方案                                               | 结论                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 插件导出时让 Figma 渲染带滤镜的图（`exportAsync`） | ✅ 和 Figma 完全一致，7 种滤镜和任意组合都管用；代价是每种"图片 + 滤镜"多一张 PNG（Gemini 背景图 425KB），在 tldraw 里改不了滤镜参数 |
| 自己推出公式，用 SVG 滤镜画                        | ❌ 暂不做。Figma 没公开公式；饱和度推出来了（见下面），曝光量了半天只对上大方向，其他几种还要一项一项猜，最后也未必准                |

具体步骤：

1. 插件（`apps/figma-plugin/code.js`）导出时遍历 REST 节点树（`filteredImagePaints()`），找出带滤镜的图片填充，按 `filteredImageKey(imageRef, filters)` 算出 key：`<imageRef>?exposure=0.499&contrast=-0.197&tint=0.853`（只列不为 0 的项，固定顺序，保留 3 位小数）。
2. 每个 key 只渲染一次（`bakeFilteredImage()`）：用节点 id 找回插件里的节点，临时建一个和原图一样大的矩形，套上同样的图片和滤镜，用 1 倍导出 PNG，导完马上删掉。文件放在 `images/<hash>-filtered-<n>.png`，`meta.filteredImages` 记 key → 路径。
3. `to-shapes.ts` 把渲染好的图按同样的 key 放进图形的 `images`；`paint.tsx` 的 `ImageLayer` 有这张图就用它，没有就用原图。带滤镜却找不到渲染好的图时（比如老版本插件导出的数据）给一条警告"图片滤镜没有效果"。key 的算法在 `apps/client/src/figma/image-filters.ts`，插件里有一份一样的。

**key 必须用 REST 数据里的值算**：同一个对比度，插件 API 里是 -1，`exportAsync({ format: "JSON_REST_V1" })` 里是 -0.3（REST 的对比度 = 插件 API 的 × 0.3，其他 6 种两边一样）。第一版插件用插件 API 的值算 key，对比度的 4 张图全部对不上。

**测试用例**：插件新加了 8 个 `image-filter/*` 用例（`imageFilterCase()`）。图片是界面里画的一张色卡（`ui.html` 的 `makeRamp()`，256 × 96：灰、红、绿、蓝、纯色相、浅色相各一行，每列一个值）。每种滤镜一个用例，同一张色卡上下排 5 个，强度分别是 -1、-0.5、0、0.5、1；`image-filter/combined` 是 5 种滤镜叠在一起。

量色卡时发现的规律（以后要自己画滤镜时用）：

- Figma 是在**线性光**下算的，换算用的是简单的 2.2 次方，不是标准的 sRGB 曲线。
- 饱和度对上了：先算亮度 `Y = 0.2126R + 0.7152G + 0.0722B`（线性值），结果 = `Y + (1 + 饱和度) × (原色 - Y)`。纯红在 -1 时是 126（实测 126），在 -0.5 时是 (203, 92, 92)（实测一样）。
- 曝光不是简单的乘法：暗部大约每 +1 曝光亮 100 倍（线性值），亮的颜色变化更陡，纯红加曝光会往白色溢出。像是先把亮度展开到 HDR 再乘、再压回来，但几个模型都只对上大方向。

### 6.9 字体代替和字体特性（2026-10-24，真实稿子考试补）

**字体代替**：稿子用了拿不到的字体时，在 CSS 字体列表里紧跟一个开源的近似字体（`fonts.ts` 的 `FONT_SUBSTITUTES`），警告写成"缺字体：Product Sans 400（用 Google Sans Flex 近似代替）"。现在只有一条：

| 稿子里的字体                            | 代替字体                                                             | 设置                                              | 理由                                                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Product Sans（Google 专有，没有网页版） | Google Sans Flex（`@fontsource-variable/google-sans-flex`，OFL 1.1） | `font-variation-settings: "wdth" 93.5, "opsz" 18` | 字形最接近；默认字宽比 Product Sans 宽 3～4%，按 8 段宽度自动的文字量了 90～100 几档，93.5 误差最小（Figma 宽度取整后，8 段总共差 6px） |

没选的：

| 方案                                     | 结论                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Google Sans（`@fontsource/google-sans`） | ❌ 比 Product Sans 宽 10% 以上（"Enter a prompt here" 159.7px，Figma 142px），比 Inter 还宽 |
| 直接用后备字体 Inter                     | ❌ 宽 8% 左右，字形差得多                                                                   |
| 找 Product Sans 的字体文件               | ❌ 专有字体，没有合法的公开下载；用户有授权的文件可以再加上                                 |

光靠代替不可能逐像素一致：代替以后 Gemini 7 页都在 1% 以下，剩下的差异都在文字字形上。

**字体特性一律重置**：seed 项目给界面用的 Inter 在 `main.css` 设了 `font-feature-settings: 'cv11', 'ss01', 'ss03'`，画布里的文字会继承下来。Figma 渲染时不开这些特性，所以 `figma-text.tsx` 的 `runStyle` 把 `fontFeatureSettings` 设成 `normal`。原来用的 Inter 3.19 文件对这几个特性没有反应，所以以前没发现；Google Sans Flex 的 `ss01` 会把双层的 a 换成单层的 a，和 Product Sans 不一样（重置后 Gemini 平均 0.87% → 0.53%）。

## 7. 对比脚本（2026-10-24）

`apps/client/scripts/compare.ts`，命令 `pnpm --filter @figma-to-tldraw/client compare [用例…]`：

1. 读 `cases/index.json`，可以只跑一部分（`compare fill/solid text/*`）。
2. 每个用例打开 `/canvas?case=<dir>&shot=1`，用真实的 2 倍屏（见下面的实现细节）。截图模式隐藏 tldraw 界面、左侧列表、选中框，把用例放在画布左上角、缩放 100%，避开右下角水印。
3. 等页面把 `window.__figmaReady` 设成 `true`（图形、字体、图片都加载完）。
4. 只截用例的渲染范围那一块（宽高 = 渲染范围 × 2，见 §9.4），和 `expected@2x.png` 用 pixelmatch 对比，存差异图。尺寸不一样时不比较，记为 100%。
5. 输出到 `reports/fidelity/<时间>/`：`index.html`（按差异从大到小排，每行三张图）、`results.json`，每个用例的 `expected.png`、`actual.png`、`diff.png`。`reports/fidelity/latest` 指向最新一次。`results.json` 里每个用例还带 `breakdown`：差异像素落在哪类节点、哪几个节点上（2026-10-24，§10.2）。`results.json` 的类型在 `apps/client/src/figma/report.ts`（新），展示页也用它。

差异百分比 = pixelmatch 判为不同的像素数 ÷ 总像素数，阈值 `threshold: 0.1`（pixelmatch 默认），开着抗锯齿检测。

实现细节（2026-10-24）：

- 截图模式（`&shot=1`）：不显示左侧列表和工具条，`<Tldraw hideUi>`，画布背景改成纯白（`figma.css` 里的 `.figma-shot`）。镜头固定在 `(40, 40)`、缩放 100%，所以 frame 在页面上的位置是 `(40, 40)`。
- **用真实的 2 倍屏，不用 Playwright 的 `deviceScaleFactor` 模拟**（2026-10-24）：模拟模式下 Chrome 按 CSS 整像素排版和对齐，165.5px 宽的方块会画成 166px；真实的 Retina 屏是按设备像素（0.5 CSS 像素）排版的，和 Figma 一致。所以脚本用 `chromium.launch({ channel: 'chromium', args: ['--force-device-scale-factor=2', '--window-size=1200,1400'] })` + `newPage({ viewport: null })`。只有"新无头模式"（`channel: 'chromium'`）认这个参数，默认的 headless shell 不认；设了 `viewport` 也会把它覆盖回 1 倍。这样截出来的才是用户在 Retina 屏上真正看到的样子（`page/gallery` 从 1.03% 降到 0.07%）。
- 浏览器窗口按用例里最大的渲染范围放大，加上四周 40、右边 200、下边 100，最小 1200×1400，右下角的 tldraw 水印落在截图区域外面（§9.5）。

> 2026-10-24 修订：原来窗口固定 1200×1400、只截 frame 的框，用例更大时脚本报错。真实稿子有 1440 宽的桌面页和超出 frame 的内容，改成按渲染范围算（§9.4、§9.5）。

- `expected@2x.png` 里 frame 外面（比如圆角外）是透明的，对比前先把它叠到白底上，和截图的白色画布一致。
- "准备好了"的判断在 `load.ts` 的 `waitForAssets`：用 `document.fonts.load` 按每段文字的字体和内容加载字体（Noto Sans SC 是按字符分包的，要带上文字才会加载对的包），图片全部 `decode()` 完，再等 `document.fonts.ready` 和两帧。
- 4 个页面并行截图，每个用例新开一个页面。
- tldraw 画图形的那一层故意多平移了 0.125px（`DefaultCanvas` 里 `translate(x + offset)`，缩放 100% 时 offset = 0.125，为了避免某些浏览器渲染发虚）。不处理的话所有图形都偏 1/4 个设备像素，深色 frame 的上边和左边会有一条半透明的边。截图模式把镜头设成 `40 - 0.125`，抵消这个偏移（2026-10-24，`page/gallery` 从 2.02% 降到 1.03%）。

## 8. 风险

| 风险                                                                                                                                                                                                                  | 应对                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 组透明度：子图形分别变透明，重叠处比 Figma 深                                                                                                                                                                         | 上层是不透明简单形状时，把下层被盖住的部分裁掉（§4.1，已做）；其他情况要把那一小块合成一个图形来画（架构改动，先问用户） |
| 混合模式、背景模糊被 `.tl-shape` 的层叠上下文隔开                                                                                                                                                                     | §6.6 的做法；实测不行再想办法                                                                                            |
| 浏览器和 Figma 的字体渲染、换行不同                                                                                                                                                                                   | 用同样的字体文件；剩下的细微差异接受                                                                                     |
| Tailwind 的样式重置影响渲染                                                                                                                                                                                           | 渲染组件里把样式写全，不依赖浏览器默认值                                                                                 |
| 平滑圆角（iOS 风格）CSS 画不出来                                                                                                                                                                                      | 用 SVG 路径近似，或接受差异                                                                                              |
| 稿子用了没有网页版的字体（如 Product Sans）                                                                                                                                                                           | 报"缺字体"警告（§9.6）；有近似的开源字体时用它代替（§6.9），否则用后备字体；要完全一致只能由用户提供字体文件             |
| 图片滤镜用的是 Figma 渲染好的图（§6.8）：在 tldraw 里改不了滤镜参数；大照片每种滤镜多一张 PNG                                                                                                                         | Demo 不改滤镜，先接受；以后要改再按 §6.8 记下的规律自己画                                                                |
| 展示页的 Figma file key 写死在代码里（§10.1），换了文件或重新复制就失效；链接只对用户自己的草稿有效                                                                                                                   | 换文件时改 `FIGMA_FILES`；以后可以试插件的 `figma.fileKey`（要开 `enablePrivatePluginApi`，未验证）                      |
| 差异归因按轴对齐的框算（§10.2），旋转、异形节点和跑出框的文字会算到别的节点上                                                                                                                                         | 只用来看"大概在哪"；要精确再按真实形状算                                                                                 |
| 展示页的分组说明（§10.3）是手写的，渲染规则改了原因会变                                                                                                                                                               | 改规则、重新考试后同步改 `groups.ts` 里的说明                                                                            |
| 商业字体（Circular Std、Proxima Nova、SF Pro）没有合法的网页版，用后备字体画（§12.1）                                                                                                                                 | 先接受，展示页写明原因；要更像可以找开源近似字体代替（§6.9），或让插件把这些文字导成轮廓（插件和转换都要改，先问用户）   |
| 字体版本靠实测比值挑出来（§12.1），`@fontsource` 升级可能换掉字体版本                                                                                                                                                 | DM Sans 锁死 4.5.9、Inter 锁死 4.5.15；升级字体包后重跑全量对比                                                          |
| 长页面分段截图（§12.2）：段与段的接缝处如果正好有动画或没画完的图块，会出一条缝                                                                                                                                       | 现在 151 个用例没有看到接缝；出现时再调 `STRIP_HEIGHT`                                                                   |
| 只有描边的投影（§12.4）不支持四边不同粗细；背景模糊"要有填充"（§12.6）没验证模糊强度和填充不透明度的关系                                                                                                              | 遇到用例再补                                                                                                             |
| 编辑时每打一个字都要重新量文字、重排一串 frame（§13.3）；最大的页面有几千个图形，没测过会不会卡                                                                                                                       | 只重排被标记的 frame（已做）；卡的话给量文字加缓存，或者打字时只量不排、停下再排                                         |
| 拉伸矢量时描边跟着变粗，Figma 不会（§13.1）                                                                                                                                                                           | 第 5 步改成按几何数据画矢量                                                                                              |
| TipTap 用 `requestAnimationFrame` 聚焦，测试用的浏览器标签页在后台时进入编辑后拿不到焦点（§13.3 实测）                                                                                                                | 只影响自动化测试；测之前把标签页切到前台（verification.md §4）                                                           |
| 自动布局只复现了 151 个用例里出现过的情况，换行、网格不支持，"Rotated Auto Layout" 这类技巧算不对（§13.2）                                                                                                            | 遇到对不上的再按数据补规则；不支持的布局在面板里写明"暂不支持编辑"                                                       |
| 对齐线改写了 tldraw 的 `editor.snaps.getSnappableShapes`，还读了缩放状态的内部字段 `info.handle`（§13.5）；拖动排顺序的动画靠 tldraw 图形外层的 `.tl-shape` 类名和 `data-shape-id` 属性（§13.6）。tldraw 升级可能改掉 | tldraw 版本锁在 3.15.6；升级后按 verification.md §3 第 20、26 条再试一遍                                                 |
| 新建图层借用 tldraw 缩放状态的 `isCreating` / `onCreate`（§14.1），这是 tldraw 自己的文字、方框工具用的约定，文档里没写                                                                                               | tldraw 锁在 3.15.6；升级后重跑手动验收第 28、29 条                                                                       |
| 图层树每次图形变化都重新读整棵树、转 JSON 比较（§14.2）；最大的用例 621 个图层没感觉到卡，几千个图层没测过                                                                                                            | 卡的话改成只在结构、名字、隐藏、锁定变化时重读                                                                           |
| 整套组件集一起导出（§16.1），Untitled UI 每页的快照到了 40 MB，打开用例要多读、多建图形                                                                                                                               | 截图对比时不建"组件"页；慢了再改成只放用到的组件集，或者打开"组件"页时才建                                               |
| "被删掉的主组件"靠"所在页面不在 `figma.root.children` 里"来认（§16.1），这是实测出来的，Figma 文档没写                                                                                                                | 认错的后果只是实例原样导入、不连主组件；导入端另有一道"主组件是空壳"的判断兜底                                           |
| 组件引擎包了 tldraw 的 `createShapes`、`deleteShapes`、`undo` / `redo`（§16.4），还依赖 `duplicateShapes` 先子后父、一次 `createShapes` 只写一次 store 这些内部做法；tldraw 升级可能改掉                              | tldraw 锁在 3.15.6；升级后跑 `instances.test.ts` 和 verification.md §3 的组件条目                                        |
| 同步按 node 字段逐个抄（§16.4），图形上 node 以外的数据只抄了 `svg`、`images`、`imageSizes`、`maskPath`、`flipX`；以后图形加了新的 props 会漏                                                                         | 加 props 时同步检查 `syncInstances`                                                                                      |
| "组件"页让大稿子打开变慢（Untitled UI 5.5 秒，§16.3）                                                                                                                                                                 | 慢了再改成打开"组件"页时才建，或只建用例用到的主组件                                                                     |

## 9. 用真实稿子考试（2026-10-24）

§4～§6 里不少规则是照着插件生成的 79 个用例反推的。为了知道换一份没见过的稿子效果怎么样，从 Figma 社区复制了两份免费文件（Untitled UI 和 Google Gemini），导出 31 个整页，放在 `cases/real/` 下面，原样跑一遍对比（结果见 [verification.md §6](verification.md#6-真实稿子考试2026-10-24)）。为此改了下面几处。

### 9.1 插件导出真实稿子

`apps/figma-plugin/code.js`：

- **目录名**（`exportDirs()`）：页面名以 `Test Cases` 开头时，还是用 frame 名字当目录（`fill/solid` → `cases/fill/solid/`）。其他页面一律放到 `real/<文件名>/<页面名>-<frame 名>`，每段都转成小写、去掉特殊字符，文件名只取前 40 个字符；重名的加 `-2`、`-3`。原因：真实稿子的 frame 名字里常有 `/`（`Plugin / file cover` 会被拆成两层目录），也经常一页里十几个都叫 `Desktop`、`Mobile`。
- **选中导出**：画布上有选中时，导出选中的 frame、组件、实例，不管它们在第几层（真实稿子里页面常放在 section 里面，不是顶层 frame）；没选中时还是导出页面上的顶层 frame。
- **跳过画不出东西的节点**：节点的 `absoluteRenderBounds` 是 `null`（整个被父级裁到外面、或者大小是 0）时，Figma 画不出它，`exportAsync` 导 SVG 会报错。Untitled UI 里有 136 个这样的图标，全都在被裁掉的区域里，对画面没有影响。插件不再导它们的 SVG，也不记警告。
- `index.json` 顶层带上 `figmaFile`、`page`、`exportedAt`，记录这批用例来自哪个文件的哪一页。

### 9.2 合并进 cases/

`apps/client/scripts/import-cases.ts`（新），命令 `pnpm --filter @figma-to-tldraw/client import-cases <zip>…`：

1. 每个 zip 解压到临时目录。
2. 把里面的用例目录拷进仓库的 `cases/`，同名目录先删再拷；目录名跑出 `cases/` 时报错。
3. 按 `dir` 合并 `index.json` 的用例列表：已有的替换，新的追加；每条用例加上 `source: { figmaFile, page, exportedAt }`。

直接解压会用新的 `index.json` 盖掉原来的列表，所以要用这个脚本。

### 9.3 转换时跳过画不出东西的矢量

`to-shapes.ts` 的 `visit()`：矢量节点的 `absoluteRenderBounds` 是 `null`，又不是蒙版时，直接跳过，不建图形也不给警告（插件不会导出它的 SVG，见 §9.1）。蒙版留着，因为后面的兄弟要用它裁剪。

### 9.4 截图范围按渲染范围算

Figma `exportAsync` 导出的 PNG 盖住的是根节点的 `absoluteRenderBounds`（包括超出 frame 的子节点和阴影），不是 frame 的框。插件生成的 79 个用例两者一样，真实稿子不一样：Untitled UI 有 3 个桌面页 frame 只有 960 高但不裁剪，内容一直画到 1066～1729；还有两个手机页的内容超出 frame 一点（左右各 2px、上面 1px）。

`apps/client/src/figma/render-area.ts`（新）的 `renderArea(snapshot)` 用根节点的 `absoluteRenderBounds` 减去 `absoluteBoundingBox`，算出渲染范围相对 frame 左上角的位置和大小（没有这两个字段时退回到用例尺寸）。用到它的两处：

- `/canvas` 截图模式的镜头改成 `SHOT_OFFSET - 0.125 - area.x`，让渲染范围的左上角落在 `(40, 40)`；差异叠加层也按渲染范围摆。
- `compare.ts` 截图时截渲染范围那一块。

### 9.5 大稿子的浏览器窗口

`compare.ts` 的 `windowFor()`：浏览器窗口取所有要跑的用例里最大的渲染范围，加上四周 40、右边 200、下边 100，最小 1200×1400。原来固定 1200×1400，1440 宽的桌面稿和 3000 多高的手机长页面放不下。

> 2026-10-24 → 2026-10-26 修订：高度不再按整页算，最多一段截图的高度（§12.2），长页面靠移动镜头分段截。

### 9.6 缺字体警告

`load.ts` 的 `waitForAssets` 加载完字体后，返回缺了哪些字体，`/canvas` 把它们放进警告（工具条和 `window.__figmaWarnings`，报告里会显示）：`缺字体：Product Sans 400（没有对应的网页字体）`。

判断办法：用 `fonts.ts` 的 `primaryFontShorthand()` 只拿第一个字体名去 `document.fonts.load`，返回空列表就是缺。不能用带后备字体的完整写法，因为那样会返回后备字体 Inter，看起来像加载成功了。

## 10. 展示页 /showcase（2026-10-24，用户追加）

`/showcase` 把每个用例的四样东西放在一起：Figma 原稿的链接、Figma 导出的截图、我们画出来的 tldraw 画布、差异分析（用户追加）。和 `/canvas` 一样不需要登录，路由直接放在 `routes/` 下面。

- **列表页** `/showcase`：顶部四个数字（用例数、平均差异、小于 1% 的个数、逐像素一致的个数）；下面按分组排卡片，缩略图是 `expected@2x.png`，右下角是差异百分比和一个颜色点（绿 < 0.1%、黄 0.1%～1%、红 ≥ 1% 或出错）。可以切成"按差异从大到小"。
- **详情页** `/showcase?case=<dir>`：标题旁是差异和结论（逐像素一致 / 几乎一致 / 细微差异 / 明显差异）；右上角"在 Figma 里打开""社区原稿""在调试页打开"；下面四格：Figma 截图、tldraw 画布、差异图、差异分析。键盘 ← → 切换上一个、下一个，Esc 回列表（焦点在画布里时不响应）。
- **数据从哪来**：用例列表、快照、截图走 `/cases/`；对比结果和差异图读 `/reports/fidelity/latest/` 下的 `results.json` 和 `cases/<dir>/diff.png`（§1.1）。没有报告时列表页提示先跑对比；报告里没有的用例显示"没有结果"。所以**展示页显示的永远是最近一次对比的结果**，只跑了一部分用例时其余的会显示"没有结果"。

代码：`apps/client/src/pages/showcase.tsx`（新）和 `apps/client/src/routes/showcase.tsx`（新），组件在 `apps/client/src/showcase/`（新）：`case-list.tsx` 列表、`case-detail.tsx` 详情、`case-canvas.tsx` 画布、`diff-analysis.tsx` 差异分析、`score.tsx` 差异等级、`sources.ts` 原稿链接、`groups.ts` 分组和说明、`use-fit-scale.ts` 缩放。

### 10.1 原稿链接

- 节点链接：`https://www.figma.com/design/<file key>/?node-id=<节点 ID，冒号换成短横>`，节点 ID 用 `index.json` 里每条用例的 `nodeId`。
- 插件导出的数据里没有 file key：插件 API 的 `figma.fileKey` 只给私有插件，要在 manifest 里开 `enablePrivatePluginApi`，没试。文件的 key（2026-10-25 起 11 份，§12） 是从 Figma 桌面版的本地设置 `~/Library/Application Support/Figma/settings.json` 读到的（打开着的标签页 `windows[].tabs[]` 的 `path` 是 `/file/<key>`，`title` 是文件名），写死在 `apps/client/src/showcase/sources.ts` 的 `FIGMA_FILES`。按文件名对上：每条用例的 `source.figmaFile`，没有 `source` 的（插件生成的 79 个）用 `index.json` 顶层的 `figmaFile`。
- 社区稿子是复制到用户草稿里的副本，节点链接打开的是副本，只有用户自己能看；所以另外给一个"社区原稿"按钮，指向社区页面（Untitled UI `community/file/1020079203222518115`；2026-10-25 加的 8 份见 `FIGMA_FILES`，链接是按文件名在网上搜到的社区页面）。2026-10-26 起去掉了用例已经删掉的 Gemini、Social App、Bankpick、FreshGo 四份（§15）。
- 换了 Figma 文件或重新复制以后，要改 `FIGMA_FILES`，否则链接打不开（见 §8）。

### 10.2 差异归因

`apps/client/src/figma/diff-attribution.ts`（新）的 `attributeDiff(snapshot, diff, scale)`。`compare.ts` 每比完一个用例调用一次，结果写进 `results.json` 的 `breakdown`，展示页直接显示：

1. **谁盖在最上面**：按 Figma 的叠放顺序遍历节点树（先父后子，后面的兄弟在上面；`itemReverseZIndex` 的倒过来，§4.3），把节点的范围"涂"进一张和渲染范围一样大的格子图（1 格 = 1 个设计像素），后涂的盖住先涂的，所以每格记的是最上面的节点。范围用 `absoluteBoundingBox` 和 `absoluteRenderBounds` 的并集（阴影、超出框的文字都在渲染范围里）；裁剪内容的 frame 里，子节点只涂裁剪框以内的部分。**只有真的盖住下面内容的节点才涂整个范围**：

   | 节点                                                                                   | 涂哪里                                                               |
   | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
   | 根节点、文字、矢量                                                                     | 整个范围                                                             |
   | 有不透明填充（纯色 alpha = 1、渐变每一档 alpha = 1、图片），本身透明度 1、混合模式正常 | 整个范围                                                             |
   | 只有半透明填充、描边或阴影                                                             | 只涂一圈：范围减去"框往里缩一个描边宽"的部分，也就是描边和框外的阴影 |
   | 什么都不画的容器（没有填充、描边、阴影）                                               | 不涂                                                                 |

   这样半透明遮罩下面的文字、透明容器下面的背景不会被上面的节点"抢走"。蒙版节点不涂；矢量和布尔运算不往下走（整个画成一张 SVG，§3）；`absoluteRenderBounds` 是 `null` 的跳过（§9.3）。

   > 2026-10-24 修订：第一版每个可见节点都涂整个范围。`gemini-plugin-file-cover` 的差异有 82% 算给了一块 52% 透明的渐变遮罩 "Rectangle 1"，实际不一样的是遮罩下面聊天截图里的 Product Sans 文字；这一页 146 个节点里还有 91 个是不画东西的容器。改成上表的规则。

2. **数差异像素**：扫 pixelmatch 输出的差异图，纯红 `(255, 0, 0)` 的像素就是算进差异的那些（黄色是抗锯齿，不算；其余是变淡的灰度原图）。坐标 ÷ 2 找到格子，记到那个节点头上。
3. **汇总**：按节点种类汇总成 `byKind`：文字（`TEXT`）、图标和矢量（`VECTOR`、`BOOLEAN_OPERATION`、`STAR`、`REGULAR_POLYGON`、`LINE`）、图片（有可见的图片填充）、背景和形状（其余：frame、矩形、椭圆等）。再按像素数取前 8 个节点放进 `nodes`，每个带名字、类型、在渲染范围里的框；文字节点再带前 40 个字和字体。

这是近似：用的是轴对齐的框，不是真实形状；代替字体比 Figma 宽时，跑出文字框的那部分会算给下面的节点。够回答"差异主要出在哪类东西上、哪几个节点上"。测试：`diff-attribution.test.ts`。

### 10.3 分组和说明

`apps/client/src/showcase/groups.ts`（新）：

- 分组：`real/` 下按前两级（`real/<文件名>`），其余按第一级目录；顺序是 `index.json` 里第一次出现的顺序。每组一行中文标题，写这组测哪些 Figma 特性。
- 说明：图片滤镜组和每份真实稿子各一段（2026-10-25 起 10 份，§12），内容取自 [verification.md §6](verification.md#6-真实稿子考试2026-10-24) 和 [§7](verification.md#7-再加-8-套真实稿子2026-10-25) 的结论；两张留作考试的稿子各加一句"修规则时没看过它的差异图"。说明只写自动算不出来、已经查清楚的原因；**改了渲染规则、原因变了时要同步改这里**（见 §8）。

### 10.4 tldraw 画布和三张图同比例

- `case-canvas.tsx` 的 `CaseCanvas` 是一个真的 `<Tldraw>`（`hideUi`、`autoFocus={false}`，不抢键盘），用 `apps/client/src/figma/editor.ts`（新）的 `putSnapshot()` 把用例画上去（和 `/canvas` 共用这段），然后切到抓手工具：拖动是平移，不会把图形拖走。
- `use-fit-scale.ts` 的 `useFitScale(area, 留白)`：缩放 = min((一栏的宽度 − 2 × 24) ÷ 渲染范围宽, max((窗口高度 − 260 − 2 × 24) ÷ 渲染范围高, 0.5), 2)。最大 2 倍是因为截图是 2 倍图；高度方向最少 0.5 倍，是因为 2000 多高的手机长页面按窗口高度缩下来只剩 0.27 倍，字都看不清，宁可让页面往下滚。Figma 截图、tldraw 画布、差异图三格用同一个缩放、同样大的框，四周各留 24px 白边，画布的镜头设成 `{ x: 24 ÷ 缩放 − area.x, y: 24 ÷ 缩放 − area.y, z: 缩放 }`，所以三张图的位置一一对上。窗口大小变了会重新算；"复位"按钮重新画图形、重设镜头。
- 留白的另一个原因：tldraw 在画布右下角画水印（没有许可证时必须显示，不能隐藏），不留白时水印正好压在设计稿右下角。
- 鼠标在画布上时滚轮是平移画布、不滚页面（tldraw 的默认行为）。
- 差异分析的节点列表里，鼠标移到（或用 Tab 选到）某个节点上，Figma 截图和差异图上会用蓝框框出它的位置（`box × 缩放`）。
- 颜色：节点种类用四个分类色、差异等级用三个状态色，写成 `apps/client/src/main.css` 里的变量（`--series-1`～`--series-4`、`--status-good` / `--status-warning` / `--status-critical`，亮色和暗色各一套）。四个分类色用 dataviz 的校验脚本查过色盲区分度，亮色、暗色都通过；亮色下后两个颜色对白底的对比度不到 3:1，所以每个色块旁边都有文字标签和百分比，不只靠颜色。

## 11. 思路介绍页 /how-it-works（2026-10-24，用户追加）

`/how-it-works` 用一页讲清楚这个 Demo 的核心思路，给没看过文档的人看（用户追加）。和 `/showcase` 一样不需要登录；`/showcase` 列表页顶部有"核心思路"入口，这一页顶部能回到展示页。

内容按这个顺序（`apps/client/src/pages/how-it-works.tsx`（新）里的几个常量）：

| 章节                | 内容                                                                                                                                                         | 出处                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 开头                | 一句话核心思路 + 最新一次对比的四个数字                                                                                                                      | 数字实时读 `results.json`（`loadLatestReport()`），不写死 |
| 1. 整条链路         | 插件 → `cases/` → 转换 → tldraw 画布 → 对比，五步                                                                                                            | §1                                                        |
| 2. 每个节点一个图形 | 四种自定义图形的表 + 节点树演示（下面）                                                                                                                      | §3、§4                                                    |
| 3. 几个关键做法     | 自己写插件、照着 Figma 画、子图形自己裁剪、矩阵算位置、算不准的交给 Figma                                                                                    | §1.2、§5、§4.2、§6.8                                      |
| 4. 怎么量"像不像"   | 差异最大的一页（50+ Landing 的 designs-30）的 Figma 图 / tldraw 截图 / 差异图三联，四条要点；2026-10-26 前用的是 Gemini 的一页，Gemini 用例去掉后换掉（§15） | §7、§9.4、§10.2                                           |
| 5. 怎么一步步变像   | 79 个单项用例 → 按特性修 → 真实稿子考试 → 再修、留两页只考不调 → 再加 8 套真实稿子（2026-10-25）→ 只留开源字体的用例 → 接上 Figma 组件（2026-10-26）         | verification.md §4～§7、§15、§16                          |
| 6. 找到的几条规律   | Inter 版本、自动行高、文字基线、虚线、0.125px 偏移、对比度单位；2026-10-25 加水平翻转、只有描边的投影、背景模糊要有填充                                      | §6.2、§6.4、§6.8、§7、§12.3、§12.4、§12.6                 |
| 7. 还做不到的       | 组透明度、只支持开源字体、滤镜参数、编辑和组件还没做的部分、Demo 不做的事（2026-10-26 改写：原来写的是"没有网页版的字体只能近似"和"不能缩放旋转"）           | §4.1、§8、§13、§15、§16                                   |

第 4 节的三张图直接用最新报告里的 `expected.png`、`actual.png`、`diff.png`（`reportUrl()`），所以要先跑过对比。除了开头的四个数字，其余数字都是历史结果，写死在页面里；**这几节是 tech.md、verification.md 的摘要，改了相关做法时要一起改**（见 §8）。

**节点树演示**（`apps/client/src/showcase/node-tree-demo.tsx`（新）的 `NodeTreeDemo`）：左边是 `page/mobile-login` 的 Figma 节点树（25 个节点，四种图形都有），每行写着"Figma 类型 → tldraw 图形类型"；右边是一个真的 `<Tldraw>`，用 `putSnapshot()` 画上这个用例，选择工具，镜头按画布大小缩放、水平居中（最大 1 倍）。

- 点左边一行 → `editor.select(图形 id)`；鼠标移上去 → `editor.setHoveredShape()`，画布上出现悬停框。
- 在画布上点图形 → 用 `useValue` 订阅选中的图形，左边对应的行高亮并滚到可见处。
- 图形类型也用 `useValue` 从画布里读（`editor.getShape(shapeIdFor(…))?.type`），不在页面里另写一份映射；没有对应图形的节点（比如布尔运算的子节点）显示"—"、不能点。
- 可以拖动图层（子图层跟着父图层走），"复位"重新画、重设镜头。画布背景用 tldraw 默认的浅灰，不像展示页那样设成白色，这样白底的 frame 能看出边界。

## 12. 再加 8 套真实稿子（2026-10-25，用户追加）

两套真实稿子不够（用户追加："把真实稿子堆到 10 套"，偏手机 App 和落地页）。又从 Figma 社区复制了 8 份免费文件，导出 33 页，合进 `cases/real/`，一共 151 个用例。文件名单、file key 和社区链接在 `apps/client/src/showcase/sources.ts` 的 `FIGMA_FILES`（§10.1），成绩见 [verification.md §7](verification.md#7-再加-8-套真实稿子2026-10-25)。

第一次跑（规则不改）33 页平均 4.71%，11 页小于 1%。下面几处是按特性修的，每一处都不是只针对某一张图。

### 12.1 字体：用和 Figma 一样的版本

和 Inter 一样（§6.4），同一种字体不同版本的字宽能差 1%～2%，换行就跟着变。所以每种字体都要找到和 Figma 一样的版本。

**怎么判断版本对不对**：拿稿子里"宽度自动、单行、没有样式覆盖、没有大小写变换、没有旋转"的文字，比 Figma 的 `absoluteRenderBounds.width`（字形实际画出来的宽度）和 Chrome `measureText` 的 `actualBoundingBoxLeft + actualBoundingBoxRight`，按字体和字重求平均比值。比值离 1 越近越对。脚本没有放进仓库（一次性的量具），做法就是上面这句。

| 字体               | 用的包                                  | 字重                    | 实测比值（Chrome ÷ Figma） |
| ------------------ | --------------------------------------- | ----------------------- | -------------------------- |
| Poppins            | `@fontsource/poppins` 5.3.0             | 400、500、600、700      | 400：0.9999                |
| Montserrat         | `@fontsource/montserrat` 5.3.0          | 400、500、600、700、800 | 0.989～1.000               |
| Lato               | `lato-font` 3.0.0（Lato 2.0），见下面   | 400～800，含斜体        | 0.997～1.002               |
| DM Sans            | `@fontsource/dm-sans` **4.5.9**（锁死） | 400、700                | 400：0.9999；700：0.9997   |
| Urbanist           | `@fontsource/urbanist` 5.3.0            | 400、500、600           | 1.0000～1.0002             |
| Lexend             | `@fontsource/lexend` 5.3.0              | 400、500、600、700      | 0.9999～1.0000             |
| Nunito             | `@fontsource/nunito` 5.3.0              | 600                     | 没有能量的样本             |
| Inter 300（Light） | 原来的 `@fontsource/inter` 4.5.15       | 300                     | 1.0000                     |

（实测，2026-10-25，151 个用例里的全部合格样本；Inter 400 有 483 段，平均 1.0001。）

- **DM Sans 要用 v1**：`@fontsource/dm-sans` 5.x 和可变字体版是 DM Sans 4.0（加了光学尺寸），比 Figma 宽 1.5% 左右；4.5.9 里是老的 v1，和 Figma 一样。4.5.10 不存在，所以写死 4.5.9。
- **Lato 要用 2.0**：Figma 的 Lato 有 Medium、SemiBold、ExtraBold，这是 Lato 2.0 才有的字重；Google Fonts 和 `@fontsource/lato` 是只有 5 个字重（100、300、400、700、900）的 Lato 1。`lato-font` 包（MIT + OFL，没有安装脚本）里是 Lato 2.0，但它自带的 CSS 把字重标错了，所以不用它的 CSS，自己在 `apps/client/src/figma/lato.css`（新）里按 Figma 的字重写 `@font-face`：normal 400、medium 500、semibold 600、bold 700、heavy 800，400、500、700 带斜体。
- 字体都在 `apps/client/src/figma/figma.css` 里 `@import`。

**拿不到的字体**（照旧报"缺字体"警告，用后备字体 Inter 画，§9.6）：

| 字体                                | 出现在                                 | 为什么没有                                                 |
| ----------------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| Circular Std、Proxima Nova          | Social App                             | 商业字体，没有合法的免费网页版                             |
| SF Pro、SF Pro Text、SF Pro Display | Social App、Bankpick、FreshGo 的状态栏 | 苹果的字体，授权只允许给苹果平台做设计和开发，不能放进网页 |
| Switzer                             | Framer SaaS                            | Fontshare 的免费字体，没找到 npm 包，没有去下载            |

这几种都没有找代替字体（§6.9 的做法）。Social App 超过 1% 的 3 页，差异像素 97% 以上落在文字上，差得最多的都是 Circular Std / Proxima Nova 的文字（§10.2 的归因）。

`FONT_METRICS`（§6.4 的基线补偿）没有加新字体的数据，这几种字体的文字差异已经很小，没有继续做。

效果：只补字体，33 页里小于 1% 的从 11 页变成 25 页，平均 4.71% → 3.85%（实测）。

### 12.2 长页面分段截图（2026-10-25，2026-10-26 修订）

`compare.ts` 的 `shoot()` 原来一次截完整个渲染范围。新稿子里有很长的页面：Framer 手机页 9497 高（2 倍图 18994 像素），截图直接报错；家具首页 6782 高，截出来顶部大图和评价区有好几块是空白，Chrome 没把它们画出来（8.82%）。Chrome 一次截图的高度有上限（大约 16384 设备像素），接近上限时画面也会缺块。

做法：按 `STRIP_HEIGHT = 2000`（CSS 像素）一段一段截，再用 pngjs 的 `PNG.bitblt` 按顺序拼成一张（`stitch()`）。只有一段时直接用，不重新编码。

1. **浏览器窗口只有一段高**（`windowFor()` 里高度取 `min(渲染范围高, STRIP_HEIGHT)` 加边距），截下一段时移动 tldraw 的镜头，不是在大窗口里换截图位置。`/canvas?shot=1` 在 `window.__figmaShotFrom(y)` 上挂了一个函数，把镜头移到渲染范围往下 `y` 的地方（`canvas.tsx` 的 `showSnapshot`）。
2. **每段截到画面稳定为止**（`settledShot()`）：截一张，等 300 毫秒（`SETTLE_MS`）再截一张，两张逐字节一样才用，最多试 10 次（`SETTLE_TRIES`）。镜头移过去以后，原来在画面外被 tldraw 隐藏的图形要重新显示、图片要解码，需要一点时间。

> 2026-10-25 → 2026-10-26 修订：原来窗口按整页高度开（§9.5），在大窗口里按 4000 一段换截图位置。家具首页还是时好时坏：单独跑、全量跑都出现过 9.07%、2.62%、1.82%，每次空白的位置不一样，有时是商品列表整块，有时是大半页。实测"页面说准备好了"的那一刻，DOM 里 398 个图形一个不少，但截一段 4000 高的图，三次里有一次那块全白，过 300 毫秒再截又好了。窗口 2200×6962、2 倍屏，Chrome 要同时备好大约 245 MB 的画面图块，超过它的图块内存预算就会丢块。只加"截到稳定为止"不够（4 次里还有 1 次 1.12%），两张都缺同一块；改成小窗口加移镜头以后连跑 4 次都是 0.23%。

效果：家具首页 8.82% → 0.23%，现在每次都是 0.23%；Framer 手机页从报错变成能比较（5.12%，剩下的差异是 §12.3～§12.5 的问题）。

### 12.3 镜像（水平翻转）

在 Figma 里水平翻转一个图层，它的变换矩阵的**行列式是负数**（`[[-1, 0, x], [0, 1, y]]` 这类）。REST 数据和插件导出的 `transforms` 里没有"翻转"这个字段，只有这个矩阵；按 §4.2 的办法从矩阵算旋转角，会算出 180°，画出来是上下颠倒的。垂直翻转等于"水平翻转 + 旋转 180°"。

做法（`to-shapes.ts` 的 `visit()`）：

1. `determinant(m) < 0` 时这个节点是镜像的，记 `flipX = true`。
2. 把矩阵右乘 `mirrorX(w)` = `[[-1, 0, w], [0, 1, 0]]`（`matrix.ts`，新），得到一个不带镜像的矩阵，按它算位置和旋转。几何上就是：先在自己的框里左右翻过来，再按这个矩阵摆放。
3. 图形的 props 加 `flipX`（`shape-types.ts`、`base.tsx` 的校验器，默认 `false`）。`FigmaShapeContainer` 给最里面那层内容加 `transform: scaleX(-1)`；外面的裁剪包装层（§5）不翻，因为裁剪路径是按没翻的坐标算的。
4. 子节点的位置照旧按父节点的页面矩阵算，用的是**没翻转的**那个矩阵；子节点自己的绝对变换里已经带着镜像，会各自算出自己的 `flipX`。

测试：`to-shapes.test.ts` 的 "turns mirrored transforms into an unrotated box with flipX"：镜像 frame、它的子节点、一个垂直翻转的矩形，位置、旋转和 `flipX` 都对。

效果：FreshGo 首页 3.36% → 0.39%，Framer 桌面页 3.21% → 0.88%，Framer 手机页 5.12% → 1.74%。

### 12.4 只有描边的图层的投影

Figma 的投影是**图层自己的形状**投出来的：填充和描边画到的地方当作完全不透明，按这个形状加偏移、扩展、模糊。子图层不参与。CSS 的 `box-shadow` 永远按整个框投影。有填充的框两者一样；**没有填充、只有描边**的框就不一样了：Figma 只有描边那一圈投影，模糊以后比整块框的影子淡得多；`showShadowBehindNode` 打开时，框里面也能看到这一圈影子。

做法（`box.tsx` 的 `StrokeShadow`，新）：满足"有可见的投影、没有可见的填充、有可见的描边、`strokeWeight > 0`、不是四边不同粗细"时，不用 `box-shadow`，改画一个 SVG：

- 按描边对齐方式算出描边中线（内描边往里缩半个线宽，外描边往外扩半个），圆角矩形用 `roundedRectPath`、椭圆用 `ellipsePath`。
- 每个投影一条路径：`stroke` = 投影颜色，线宽 = 描边粗细 + 2 × 扩展，按偏移平移，`feGaussianBlur` 的 `stdDeviation` = 模糊半径 ÷ 2（和 §6.3 的换算一样）。
- 所有投影都没开 `showShadowBehindNode` 时，加一个遮罩把框里面挖掉（Figma 默认不在图层后面画影子）。

四边不同粗细的描边还是用 `box-shadow`，没有做。

效果：Framer 桌面页 0.88% → 0.25%；Framer 手机页 1.74% → 0.70%（和 §12.5 一起）。

### 12.5 文字里的 U+2028

Figma 把 U+2028（LINE SEPARATOR）当成段内换行：换到下一行，但不算新段落，不加段间距。实测 Chrome 没有在这里换行（Framer 手机页页脚的卡片 "…by connecting \u2028with your favorite tools…"：Figma 在 connecting 后面换行，我们没换，后面几行的断行跟着全变了）。

做法：`figma-text.tsx` 的 `paragraphs()` 按 `\n` 分段以后，把每段里的 U+2028 换成 `\n`，在同一段里换行。

### 12.6 背景模糊要有填充

Figma 只在图层**有可见填充**的地方画背景模糊：填充全部隐藏，或者填充的不透明度是 0，就不画。设计师常用"填充不透明度 1%"来做一块透明的毛玻璃（Framer 深色页的导航栏就是这样），也是这个原因。

`designs-29` 有一个叫 "Conent" 的 frame，填充隐藏了，只留着 12 的背景模糊。Figma 的图里后面的照片是清楚的，我们原来把照片糊掉了一块。

做法（`box.tsx` 的 `BackdropBlur`）：至少有一个可见填充、它的不透明度和颜色 alpha 都大于 0，才画背景模糊层。

没验证的：模糊强度会不会随填充不透明度变化（现有用例的填充都是 1%～100%，看不出来）；渐变填充所有色标 alpha 都是 0 时 Figma 怎么画。

效果：designs-29 1.17% → 0.36%；其他带背景模糊的用例分数不变。

## 13. 在 tldraw 里编辑（2026-10-25，用户追加）

方向按 [probe-editing.md](probe-editing.md) 的结论定（用户拍板）：图形和画法不动，Figma 节点数据 `props.node` 仍然是唯一的数据来源，编辑就是改它。这次做了调研里建议的前 4 步（用户确认范围，自动布局算在内，组件实例当普通 frame）：缩放和选择、自动布局、文字编辑、属性面板。矢量改颜色（第 5 步）和图层面板等（第 6 步）没做。

> 2026-10-25 补：第 6 步里的新建图层工具和图层树做了，见 §14。

只有 `/canvas` 打开编辑：`pages/canvas.tsx` 的 `handleMount` 调 `startFigmaEditing(editor)`，展示页和介绍页还是只能看。导入用例时 `putSnapshot` 包在 `withoutFigmaEffects` 里，加载过程不触发重新量文字和重排，所以导入画出来的东西和以前一样（还原度对比不变，见 [verification.md §4](verification.md#4-各次实际结果)）。

加载用例不进撤销记录（2026-10-25 补）：`putSnapshot` 用 `editor.run(…, { history: 'ignore' })` 建图形，建完调 `editor.clearHistory()`。原来加载本身是一步撤销，刚打开用例按 Cmd+Z 整张图就没了，编辑后多撤销几步也会这样；切换用例后还能撤销到上一个用例的改动上。

代码在 `apps/client/src/figma/editing/`（新）：

| 文件               | 内容                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `index.ts`         | `startFigmaEditing`：打开下面的引擎和选择规则；导出面板和 `figmaTextOptions`                         |
| `engine.ts`        | 编辑引擎：监听图形变化，量文字、套约束、标记要重排的 frame，一次操作结束后统一重排；缩放时改尺寸方式 |
| `auto-layout.ts`   | 自动布局算法，不依赖 tldraw，测试里直接跑在快照数据上                                                |
| `constraints.ts`   | 约束：父 frame 变大小时子图层怎么动                                                                  |
| `host.ts`          | 把 tldraw 图形接到自动布局算法上：图层在父图层里占的框、怎么把新框写回图形                           |
| `selection.ts`     | Figma 式的单击、双击、Esc / Enter 选择                                                               |
| `snapping.ts`      | 对齐线：默认吸附，吸附目标按 Figma 的规则挑（§13.5）                                                 |
| `drag-style.ts`    | 拖动排顺序时兄弟滑开的动画、被拖的图层画在最上面（§13.6）                                            |
| `text-measure.tsx` | 按画法量文字尺寸                                                                                     |
| `rich-text.ts`     | Figma 文字和 TipTap 文档互相转换；加给 TipTap 的两个扩展                                             |
| `panel.tsx`        | 属性面板                                                                                             |
| `panel-ops.ts`     | 面板里改文字样式、填充、圆角、自动布局开关这些"改一处要连带改别处"的操作                             |

**引擎怎么跑。** `enableFigmaEditing` 在 tldraw 的 `editor.sideEffects` 上挂四个回调：图形改了、建了、删了，以及"一次操作结束"（`registerOperationCompleteHandler`）。前三个只做两件事：马上要做的（文字内容变了就重新量、frame 变大小就套约束）当场做；要重排的 frame 和组记进一个"待办"集合。操作结束时按层级从深到浅处理待办：自动布局 frame 重排、组重算边界。先深后浅，里层"包裹内容"的 frame 先定好尺寸，外层再排。回调里改的东西和用户的操作落在同一个撤销步骤里，所以一次撤销能整个退回。

### 13.1 缩放、旋转、约束、组和选择

**打开缩放。** `shapes/base.tsx` 里 `canResize` 和显示缩放、旋转手柄都看 `isFigmaEditing(editor)`，只在 `/canvas` 打开。

**缩放时改尺寸方式。** 拖手柄最后调 `engine.ts` 的 `figmaResize`：先用 tldraw 的 `resizeBox` 算新框，再用 `resizedNode` 改节点数据，和 Figma 一样：

- 被拖动的那条轴变成"固定"（FIXED）。拖一个"包裹内容"的 frame 的边，它就不再包裹。
- 文字：拖上下边或角，变成固定大小（`textAutoResize: NONE`）；只拖左右边，自动宽度变成自动高度（`HEIGHT`），宽度固定、高度跟着内容走。

面板里改 W / H 也走 `resizedNode`（§13.4）。

**约束（`constraints.ts`）。** 普通 frame（不是组）变大小时，引擎对每个不参与自动布局的子图层调 `constrain`：左 / 右 / 居中 / 左右 / 缩放，上 / 下 / 居中 / 上下 / 缩放，和 Figma 一样。两个细节：

- 旋转过的子图层（`host.ts` 的 `isRigid`，旋转角不是 0）不改尺寸，只挪位置；遇到"左右 / 上下"这种要拉伸的约束，挪半个变化量，保持中心位置。
- 自动宽度的文字被"左右"约束拉宽时，改成自动高度，不然文字会自己缩回去。

**组（GROUP）。** `canResizeChildren` 只对组返回 true：拖组的手柄时子图层一起缩放（tldraw 的缩放工具自己会缩放子图形）；frame 不缩放子图层，子图层按约束摆。组的边界跟着子图层走：子图层移动、缩放、增删后，`fitGroup` 重算边界，挪动组、反向挪动子图层，让子图层在画布上不动。边界不能直接取子图层的并集，因为导入时有三种情况会对不上：被跳过的隐藏子图层、画不出东西的矢量（§9.3），以及矢量的渲染范围偏差。所以组创建时先量一次"子图层并集和组自身边框的差"（叫它余量，slack），以后算边界都加上它；被蒙版裁剪的子图层按蒙版的框算。这样导入后什么都不改时，重算边界的结果和原来一样。

**矢量拉伸。** 插件导出的 SVG 有固定的 `width` / `height`，拉伸图形时图标不变。`figma-vector.tsx` 的 `stretchable` 给 SVG 加 `preserveAspectRatio="none"`，`figma.css` 让 SVG 撑满图形。描边粗细会跟着拉伸，而 Figma 拉伸矢量时描边粗细不变。这个差异等第 5 步改成按几何数据画再解决。

**选择（`selection.ts`）。** tldraw 默认单击选中最外层的图形（就是整页的根 frame），双击才往里走一层，和 Figma 差别很大。做法是改写 `editor.getOutermostSelectableShape`（tldraw 每次单击都问它"这一下选谁"）：把页面最外层的图形和当前选中图层的所有上级都当成"已经打开"，单击选中从外往里第一个没打开的图层。效果和 Figma 一样：一开始单击选中根 frame 的直接子图层；选中一个按钮后，再单击旁边的图层选中按钮的兄弟，单击按钮里面选中按钮里的子图层。

- 双击：`onDoubleClick` 选中鼠标下面、比当前选中深一层的图层；返回一个空改动，阻止 tldraw 在双击处新建文字。深一层正好是文字时直接进入编辑（§13.3）。
- 键盘：Esc 或 Shift+Enter 选父图层，Enter 选子图层，和 Figma 一样。在 `window` 上按捕获阶段监听，只在选择工具空闲、画布有焦点、焦点不在输入框时生效；选中的是文字时 Enter 交给 tldraw，进入编辑。

### 13.2 自动布局

**数据。** `types.ts` 的 `FigmaLayoutProps` 列出插件导出的自动布局字段（方向、换行、内边距、间距、对齐、尺寸方式、`layoutPositioning`、最小最大尺寸、约束）。尺寸方式有新旧两套：新的 `layoutSizingHorizontal` / `layoutSizingVertical`（FIXED / HUG / FILL），旧的 `layoutGrow`、`layoutAlign`、`primaryAxisSizingMode`、`counterAxisSizingMode`。有新字段就用新字段（`axisSizing`）：有的 frame 旧字段写 STRETCH，新字段写 HUG，Figma 画出来是 HUG。没有新字段才看旧字段。REST 格式会省略默认值：尺寸方式省略表示 AUTO（包裹），对齐省略表示 MIN。

**算法（`auto-layout.ts`）。** `layoutFrame` 输入一个 frame 和它的子图层，输出 frame 自己的尺寸和每个子图层的框；`relayout` 通过一个抽象的 `LayoutHost` 读写数据。测试里的 `SnapshotHost` 直接用快照里的变换矩阵，`host.ts` 的 `tldrawLayoutHost` 用 tldraw 图形，算法是同一份。下面这些规则是对着 151 个用例的数据一条条找出来的：

| 规则                                                                              | 依据                                                                        |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 旋转过的子图层不改尺寸，占位按旋转后的外接框算                                    | 带旋转子图层的 frame 只有这样才对得上                                       |
| frame 自己的尺寸用它自己的宽高，不用外接框                                        | 旋转过的 frame 用外接框会越排越大                                           |
| 两端对齐（SPACE_BETWEEN）里有"填充"的子图层时，分配剩余空间不扣间距               | Gemini 的 Frame 27                                                          |
| 两端对齐只有一个子图层时放在开头                                                  | 插件最新导出的用例是放开头；Golio 的 5 个旧 frame 是居中，接受这 5 个对不上 |
| 包裹内容的交叉轴尺寸只看不"填充"的子图层；全都填充时才看全部                      | 按钮里文字填充、图标固定的情况                                              |
| 排列顺序是子图层数组的顺序；`itemReverseZIndex`（First on top）时是叠放顺序倒过来 | §4                                                                          |
| 绝对定位（`layoutPositioning: ABSOLUTE`）的子图层不参与排列，按约束摆             | Figma 的定义                                                                |
| 换行（WRAP）和网格（GRID）不重排，保持原样                                        | 这次不做                                                                    |

**什么时候重排（`engine.ts` 的 `onChange`）。** 自动布局 frame 自己变大小或节点数据变了，记它；参与排列的子图层变大小、节点数据变了、换了顺序或父图层、被挪动（拖动过程中除外），记它的父图层。父图层是组时一样记下，操作结束时重算组的边界。

**拖动排顺序。** 拖动过程中就实时交换，兄弟图层滑开让位，松手后被拖的图层落进空位，做法见 §13.6。拖到组里的图层松手后重算组的边界。

> 2026-10-25 → 2026-10-25 修订：原来拖动时兄弟不动，松手时按主轴方向比较图层中心定顺序。现在按 Figma 的方式拖动时实时交换（用户追加）。

**结果。** 每个用例整棵树重排一遍，看图层有没有动（测试 `auto-layout.test.ts`，读 `cases/`）：15644 个图层里 15620 个不动。在 tldraw 里对真实图形跑一遍（[verification.md §4](verification.md#4-各次实际结果)）：15172 个图形里 28 个动了，原因都已知：

- product-list 的标签栏差 1/3～1 像素（Figma 自己的取整）。
- Golio 的 5 个 "Company Logo" 差 6 像素（上面说的单个子图层居中）。
- furniture 的 12 个 "Aspect ratio keeper # Rotated Auto Layout" 差 7.63 像素：用旋转的自动布局 frame 保持图片比例的技巧，Figma 的结果我们算不出来。
- Golio 旋转提示框里的 3 个矢量差 3～6 像素：旋转 frame 里矢量的渲染范围换算不准。
- Gemini 一段文字重新量出来差 0.81 像素，它所在的 "Prompt Cards" 跟着动。

### 13.3 文字：重新量尺寸和编辑

**量尺寸（`text-measure.tsx`）。** `figma-text.tsx` 把画文字的代码拆成 `textLayout`（算样式）和 `textBody`（生成每段每个片段），导出的 `TextInner` 只画文字块本身。`measureText` 用 `renderToStaticMarkup` 把 `TextInner` 渲染进编辑器容器里一个隐藏的 div 量尺寸，画法和量法是同一份代码，换行一定一致。自动宽度用 `width: max-content`，自动高度用固定宽度。调研时实测 2812 段文字里 2811 段量出来的行数和 Figma 一样（[probe-editing.md §3.5](probe-editing.md#35-文字编辑)）。

**什么时候量（`fitText`）。** 文字内容或样式（不算颜色）变了，或者自动高度的文字宽度变了，就重新量。自动宽度的文字变宽时按对齐方式决定往哪边长：居中两边长，右对齐往左长，和 Figma 一样。尺寸变了会接着触发父图层重排。

**编辑用 tldraw 自带的 TipTap。** `figma-text.tsx` 的 `EditableText`：

- `canEdit` 在编辑打开时返回 true；进入编辑后，把静态文字换成 tldraw 的 `RichTextArea`（TipTap 富文本编辑器），事件处理用 `useEditableRichText` 给的那套，只有 `handleChange` 换成自己的：把 TipTap 文档转回 Figma 的 `characters` / `characterStyleOverrides` / `styleOverrideTable`，写进 `props.node`。写进去之后就是普通的节点变化，引擎重新量尺寸、重排。
- `RichTextArea` 发现传进来的 `richText` 和它自己最后交出去的不是同一个对象时，会调 `setContent` 整个替换内容，光标会跳到末尾。所以把它最后交出来的文档存在一个 tldraw atom（`useAtom`）里，节点内容和它对得上时原样传回去。
- 和 tldraw 自己的 `RichTextLabel` 一样，文字被选中时就先挂上 `RichTextArea`（没进入编辑时它什么都不画，但已经在监听"全选""放光标"事件），不然 tldraw 开始编辑时发的"全选"事件会漏掉。
- 编辑结束时文字是空的，删掉这个图层（`onEditEnd`），父图层重排把空位收掉。

**怎么进入编辑。** 选中文字后双击或按 Enter（tldraw 自带，进入时全选文字）。另外，选中一个 frame 后双击它里面的文字，直接进入编辑，不用先双击选中文字再双击一次（`selection.ts` 的 `figmaDoubleClick` 自己调 `select`、`setEditingShape` 和切到 `select.editing_shape` 状态）。这条路进入时文字原来没选中，`RichTextArea` 是在这一刻才挂上的，所以由 `EditableText` 挂上之后自己补发一次"全选"。

**转换（`rich-text.ts`）。**

| Figma                     | TipTap                                           |
| ------------------------- | ------------------------------------------------ |
| `\n`（段落）              | 段落（paragraph）                                |
| U+2028（段内换行）        | 换行节点（hardBreak）                            |
| 样式覆盖号不为 0 的一段字 | 带 `figmaStyle` 标记，属性是覆盖号和显示用的 CSS |
| 换行符自己的覆盖号        | 段落或换行节点上的 `figmaBreak` 属性             |

- 新打的字跟着光标所在那段的样式走（TipTap 的标记默认向后延续），和 Figma 一样。
- Cmd+B / Cmd+I / Cmd+Shift+S（TipTap 的粗体、斜体、删除线标记）转回来时变成新的样式覆盖：字重 700、`italic`、删除线。同样的样式只建一条。标题、列表这些 Figma 没有的结构当普通段落。
- 两个扩展（`figmaStyle` 标记和 `figmaBreak` 属性）接在 tldraw 默认扩展后面，组成 `figmaTextOptions`，传给 `<Tldraw textOptions>`。它必须在整个页面生命周期里是同一个对象，`RichTextArea` 看到配置对象变了会重建编辑器。
- 换行符自己的覆盖号画的时候用不到，留着它是为了来回转换完全一致：151 个用例里 3215 段文字转成 TipTap、经过 TipTap 真实的 schema、再转回来，全部和原来一样（`rich-text.test.ts`）。

**编辑时的样子。** 编辑框用和静态文字一样的外层和内层样式，位置一样。实测进出编辑时文字的横向位置和宽度完全一致，纵向差 1 像素（静态文字量的是行内框，编辑框量的是段落框）。几处要处理：

- tldraw 给编辑框（`.tl-text-input`）设了绝对定位、`text-transform: none`、`white-space: pre-wrap`、`font-kerning: auto` 等，`figma.css` 在 `.figma-text-editing` 下改成继承文字自己的样式，不然大写、自动宽度不换行、字距都会变。
- 渐变文字静态时是透明字加背景裁剪（§6.7），编辑时用渐变的第一个颜色显示。
- 编辑时去掉行数截断和图层模糊。

**已知的小问题。** 进入编辑时是全选状态，这时按 Enter 不起作用，要先按方向键或点一下放光标（TipTap 本身的行为，tldraw 自带文字也一样）。macOS 上 End 键只滚动不移光标。

### 13.4 属性面板

**接到 tldraw 上。** `components.StylePanel` 换成 `FigmaStylePanel`：选中的全是 Figma 图形时，在 tldraw 的 `DefaultStylePanel` 外壳里放我们的面板（外壳自带"在面板里按 Esc 回到画布"、滚轮转给画布）；否则显示 tldraw 自带的面板。tldraw 把面板宽度和最大宽度都定成 148px，`figma.css` 在面板里有 `.figma-panel` 时改成 252px，太高时可以滚动。

**内容（从上到下，按选中图层的类型显示）。**

| 区块       | 显示给                                   | 能改的                                                                                                       | 写到哪                                                                        |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 位置和尺寸 | 全部                                     | X、Y（相对父图层；参与自动布局时置灰）、W、H（组置灰，拖手柄缩放）、旋转（角度，逆时针为正，和 Figma 一样）  | 图形的 `x` / `y` / `rotation`、`props.w` / `props.h`，节点按 `resizedNode` 改 |
| 自动布局   | frame（不含组）                          | 无 / 横向 / 纵向、3 × 3 对齐、间距、两端对齐、四边内边距                                                     | 节点的自动布局字段（`setLayoutMode`）                                         |
| 尺寸方式   | 自动布局 frame、文字、自动布局里的子图层 | 宽、高各自固定 / 包裹 / 填充，只列这个图层能用的                                                             | `engine.ts` 的 `setSizing`（新旧两套字段一起改；文字连带改 `textAutoResize`） |
| 约束       | 普通 frame 里的子图层、绝对定位的子图层  | 横、纵                                                                                                       | `constraints`                                                                 |
| 外观       | 全部                                     | 透明度（矢量置灰）、圆角（矩形和 frame）、裁剪内容（frame）                                                  | 透明度同时写图形的 `opacity`（tldraw 用它画）和节点的 `opacity`               |
| 文字       | 文字                                     | 字体、字重、字号、行高（数字或"自动"）、字距、左中右两端对齐、顶中底对齐、大小写、下划线 / 删除线            | `panel-ops.ts` 的 `setTextStyle` / `setLineHeight`                            |
| 填充       | 除组以外                                 | 每层的显示隐藏、颜色（取色器或十六进制）、不透明度、删除、新加一层纯色；渐变和图片只能改显示、不透明度、删除 | `fills`；文字用 `setFills`                                                    |
| 描边       | 除组和文字以外                           | 同填充，加粗细和内 / 居中 / 外                                                                               | `strokes`、`strokeWeight`、`strokeAlign`                                      |
| 效果       | 除矢量以外                               | 每个效果的显示隐藏、种类、颜色、X / Y、扩展、透明度、模糊；新加投影                                          | `effects`                                                                     |

**撤销。** 每次提交（回车、失焦、点按钮）先 `markHistoryStoppingPoint` 再改，一次提交是一个撤销步骤；改动引起的重新量文字、重排都在同一步里。取色器拖动时会连续改很多次，只在按下时记一次，整个拖动是一步。

**多选。** 每一项的值都一样就显示，不一样显示"混合"；改的时候对所有选中的图层生效，不适用的区块不显示。

**改文字样式时连带改的（`panel-ops.ts`）。**

- 面板改的是整个文字图层：设置字号、字重这类属性时，同时从所有样式覆盖里删掉这一项，整段统一，Figma 也是这样。某一项在不同字符上不一样时，面板显示"混合"。
- 改字号时，如果行高是相对的（"自动"或百分比），`lineHeightPx` 按比例缩放；行高是固定像素时不变。
- 行高设成"自动"时要写一个像素值（画法用它，§6.4），取"字号 × 这个字体的自动行高比例"。比例从用例数据里读出来：Inter 1.2102、Lato 1.2、DM Sans 1.302、Poppins 1.5、Montserrat 1.219、Red Hat Display 1.323、Noto Sans SC 1.2、Product Sans 1.213、Nunito 1.364，别的字体按 1.2。
- 改文字颜色时，`fills`、`style.fills` 一起改，样式覆盖里的颜色删掉。

**没做的。** 矢量的填充、描边、透明度只显示不能改（颜色和透明度写死在 SVG 里，第 5 步再做）；组不能在面板里改 W / H；渐变和图片填充不能改颜色和图片；四个角不同圆角、四边不同描边粗细只能显示"混合"，改了就变成统一的值；字重下拉不检查字体有没有这个字重（没有时浏览器会模拟加粗）；在面板输入框里按 Esc 会提交已经输入的内容，而不是撤回。

### 13.5 对齐线（吸附）（2026-10-25，用户试用发现）

用户试用时发现拖手柄调整大小没有对齐线（用户试用发现）。吸附本身能用，被两处挡住了：

1. tldraw 默认不吸附，按住 Cmd 才吸附。菜单里打开"总是吸附"（用户偏好 `isSnapMode`）后才反过来：默认吸附，按住 Cmd 临时不吸附。Figma 是默认吸附。
2. tldraw 只拿选中图层的共同父图层里的兄弟当吸附目标（`editor.snaps.getSnappableShapes`）。父图层本身只有是 tldraw 自带的 frame 才算，我们的 frame 是自定义图形 `figma-frame`，所以子图层对不齐父 frame 的边和中线。

**做法。** `editing/snapping.ts`（新）的 `installFigmaSnapping`，在 `startFigmaEditing` 里打开：

- 打开编辑时把 `isSnapMode` 设成 true。这个偏好 tldraw 存在浏览器的 localStorage 里；在菜单里关掉"总是吸附"只管这一次，刷新页面又会打开。
- 改写 `editor.snaps.getSnappableShapes`（和 §13.1 改写 `getOutermostSelectableShape` 是同一个办法），结果用 tldraw 的 `computed` 缓存。选中的全是 Figma 图层时，目标这样挑：
  - 容器：选中图层的共同父图层，是组就往上找到第一个不是组的 frame。容器自己算目标（四条边和中线）。
  - 容器里的子图层算目标。组本身不算，往组里面找；选中的图层不算；不在屏幕里的不算（tldraw 原来也这样）。
- 选中的不全是 Figma 图层时，还用 tldraw 原来的规则。

**会跟着动的图层不能当目标。** 在自动布局里拉一个图层，排在后面的兄弟会被挤走，包裹内容的父 frame 会变大。拿它们当目标，对齐线会追着拖动跑。比如间距为 0 的一排按钮，拉第一个的右边时，第二个的左边一直贴着它，鼠标每动一点都被吸回去，拉不动。间距比吸附距离（屏幕上 8 像素）小时也会来回跳。所以 `followers` 先算出这次拖动会带动哪些图层，把它们去掉：

- 父图层是自动布局 frame，被拉的图层参与布局，并且拉的是主轴方向：主轴对齐是"开始"时排在后面的兄弟会被挤走，"末尾"时前面的，居中和两端对齐时全部算（两端对齐时偏保守）；主轴"填充"的兄弟会变大小。
- 拉的是交叉轴方向，而且父 frame 交叉轴是"包裹"：交叉轴对齐不是"开始"的兄弟会移动，交叉轴"填充"的兄弟会变大小。
- 父 frame 在被拉的方向上是"包裹"，或者父图层是组：父图层自己的边框会变，不当目标；再往上一层，按同样的规则接着算。
- 被挤走的图层连同里面的东西都不算。只是边框变了的组照样往里找，因为组里别的图层在画布上不动（§13.1 的 `fitGroup`）。

"拉的是哪个方向"看手柄：拖左右边只算横向，拖上下边只算纵向，拖角两个方向都算。这样竖排列表里横着拉一个图层，下面的兄弟只会上下移动，照样能当目标。文字和包裹内容的自动布局 frame 拉一边时，另一边也可能跟着变（文字换行变高），按两个方向都算。

**拖动排顺序时不吸附。** 移动自动布局里参与布局的图层是在排顺序（§13.2），松手后位置由布局决定，Figma 这时也不显示对齐线，所以这时没有目标。

**实测**（2026-10-25，Playwright 在无头 Chrome 里用鼠标拖手柄，读 `editor.snaps.getIndicators()`）：

| 用例和操作                                                 | 结果                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `page/mobile-login`：Sign in 按钮的右边拖到页面中线附近    | 吸到 x = 187.5，显示对齐线（截图确认）                                |
| 同上：Logo 的右边往右拉到 349                              | 吸到 351，和下面图层的右边对齐                                        |
| 同上：Logo 拖右下角                                        | 只剩整页 frame 当目标：拉高 Logo 会把下面的图层挤走                   |
| 同上："Remember me" 那一行里拉复选框的右边                 | 没有目标：后面的文字会被挤走，这一行是包裹宽度，它的父 frame 两端对齐 |
| 同上：拖动 "Remember me" 排顺序                            | 没有对齐线                                                            |
| `container/nested-frames`：矩形拉右边、移动到父 frame 中间 | 吸到父 frame 的中线                                                   |
| `container/group`：组里的圆拉右边                          | 吸到组里矩形的右边，外面 frame 也是目标                               |

**没做的。** Figma 吸附时会标出和旁边图层的距离数字，tldraw 只画红线和等间距标记，没加。按住 Shift 拉一条边是等比缩放，两个方向都会变，但排除规则还是只按一个方向算，间距很小时可能会跳（未验证）。

### 13.6 拖动时实时交换（2026-10-25，用户追加）

用户要求拖动自动布局里的图层时能和同一个 frame 里的兄弟交换位置，给了一段 Figma 录屏做参考（用户追加）。

**录屏里 Figma 的行为**（逐帧量了两个矩形的位置）：

- 被拖的图层一直跟着鼠标走，不吸到格子里。
- 被拖图层**前进方向的边越过兄弟的中线**时两者交换：往上拖看上边，往下拖看下边。录屏里第二次拖动时，小矩形上边到 412 像素、大矩形中线在 410 像素，下一帧大矩形就开始往下移。
- 被越过的兄弟**滑**到新位置，大约 0.15 秒，先慢后快再慢。
- 松手时被拖的图层直接落进空位，没有动画。

**做法。**

1. `engine.ts` 的 `onChange`：拖动中（`select.translating`）被选中的图层位置变了，而且它在自动布局里参与排列，就记进 `dragged`。
2. 操作结束时 `flush` 先对 `dragged` 里的每个图层调 `swap`：拿它当前的框和兄弟的中线比，规则和录屏一样。先看往前能不能越过前一个兄弟，不能再看往后，一次移动越过几个就交换几次。顺序变了就用 `getIndexBetween` 改它的 `index`。`index` 一变，父 frame 被记下要重排。
3. 重排时把被拖的图层**钉住**：`host.ts` 的 `tldrawLayoutHost` 多了 `pinned` 参数，钉住的图层不写回位置，只占着它的空位。所以兄弟按新顺序让开，被拖的图层还在鼠标下面。只在拖动中钉住；松手时 `figmaTranslateEnd` 再按同样的规则算一次（一般不变），然后不钉住重排，被拖的图层落进空位。
4. 兄弟的位置在数据里是一下子改到位的，所以撤销、点选、吸附都按最终位置算。整个拖动是一个撤销步骤；拖到一半按 Esc，tldraw 撤回到拖动开始前，顺序和位置都恢复。

鼠标不动时顺序不会自己来回变。往上越过兄弟的条件是被拖图层上边 < 兄弟原来的中线；兄弟移到空位下面以后，要换回来得让被拖图层下边越过兄弟的新中线，折算下来是上边 > 兄弟原来的中线 + 间距。两个点相差一个间距，间距为 0 时正好重合。间距是负数时中间有一段两边条件都满足，每动一下鼠标都会换一次（未验证）。

**动画（`drag-style.ts`（新）的 `installDragStyle`）。** tldraw 每个图形是一个 `.tl-shape` 元素，用 CSS `transform` 摆在画布上，带 `data-shape-id` 属性。第一次检测到拖动自动布局里的图层时，往编辑器容器里加一个 `<style>`：

- 所有 `.tl-shape` 加 `transition: transform 150ms ease-in-out`，兄弟（连同它们里面的图层）的位置一变就滑过去。拖动时别的图形不会动，所以不用一个个挑。
- 被拖的图层和它里面的图层去掉过渡（不然会慢半拍跟着鼠标），`z-index` 提到 1000000 以上，按原来的先后顺序排，画在所有图形上面。不然交换以后它的叠放顺序排到兄弟下面，会被兄弟盖住。Figma 拖动时被拖的图层也在最上面（录屏里两个矩形颜色一样，看不出来，是我定的）。
- 离开拖动状态（用 tldraw 的 `react` 盯着 `editor.isIn('select.translating')`）0.15 秒后把 `<style>` 删掉，让最后一次交换的动画放完。

动画只是画面上的，数据里的位置不会经过中间值。没用 tldraw 的 `editor.animateShapes`：它每一帧都往数据里写中间位置，会进撤销记录，还会触发编辑引擎重排。

**实测**（2026-10-25，Playwright 在无头 Chrome 里用鼠标拖，`/canvas?case=page/mobile-login`）：

| 操作                                   | 结果                                                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Sign in 按钮一路往上拖到顶             | 上边到 378.5 时越过 "Options" 那一行的中线（381），两者交换；之后依次越过两个输入框、副标题、标题、Logo，每次被越过的图层下移 |
| 松手                                   | 按钮落到最上面的空位（y 88）；撤销一次全部恢复                                                                                |
| Logo 一路往下拖                        | 下边越过下面图层的中线时交换，松手落进空位                                                                                    |
| 横排的 "Divider" 里把 "or" 往右拖      | 越过右边线条的中线后交换                                                                                                      |
| 拖到一半按 Esc                         | 顺序和位置全部恢复                                                                                                            |
| 交换后每 20 毫秒读一次兄弟的 transform | "Options" 从 372 滑到 435 用了约 150 毫秒，先慢后快再慢                                                                       |
| 拖动有子图层的密码输入框               | 输入框和里面的文字、眼睛图标没有过渡、`z-index` 在最上面；被挤开的邮箱输入框有 0.15 秒过渡                                    |
| 普通 frame（不是自动布局）里拖矩形     | 不加 `<style>`，和原来一样                                                                                                    |

**没做的。** 不能拖出父 frame 放进别的 frame：tldraw 拖动时换父图层要父图形实现 `onDragShapesOver` / `onDragShapesOut`，我们的 frame 没实现，拖到 frame 外面也只是排到第一个或最后一个；同时拖好几个自动布局里的图层时，每个图层各自按规则交换，没有像 Figma 那样当成一组；方向键在 Figma 里能调整自动布局里的顺序，这里没做。

## 14. 新建图层和图层树（2026-10-25，用户追加）

用户要求能在画布上新建 Figma 的图形和文字，左边有和 Figma 一样的图层树（用户追加），也就是 [probe-editing.md](probe-editing.md) 第 6 步里的两项。范围按用户定的来：

- 先做新建工具和图层树，图层树里拖动行来调整顺序、移进别的 frame 放到下一步，和"画布上把图层拖进别的 frame"一起做（用户确认）。
- tldraw 自带的工具只留画笔和箭头，便签、橡皮去掉（用户拍板）。自带的几何图形、文字、frame 被 Figma 的同名工具代替；直线、荧光笔、激光笔、插入图片用户没提，我先一起拿掉了，要的话加进 `tools.tsx` 的 `KEPT_TOOLS`。
- 直线、箭头、多边形、星形、钢笔这几种 Figma 图形没做。矢量现在画的是插件导出的 SVG（§3），自己新建的矢量没有 SVG，要等第 5 步改成按几何数据画。

| 文件（新）           | 内容                                                       |
| -------------------- | ---------------------------------------------------------- |
| `editing/create.ts`  | 新图层的节点数据、放进哪个 frame、在自动布局里排到哪个位置 |
| `editing/tools.tsx`  | 四个新建工具（tldraw 的 `StateNode`）、工具栏、快捷键      |
| `editing/layers.tsx` | 图层树                                                     |

`pages/canvas.tsx` 给 `<Tldraw>` 加了 `tools={figmaTools}`、`overrides={figmaUiOverrides}`、`components.Toolbar`、`getShapeVisibility` 和 `options.createTextOnCanvasDoubleClick: false`。左栏上面是可以折叠的用例列表（相当于 Figma 的 Pages），下面是图层树。

### 14.1 新建图层

**工具栏。** 移动 V、抓手 H、Frame F、矩形 R、椭圆 O、文字 T、画笔 D、箭头 A。`figmaUiOverrides.tools` 把四个新工具加进 tldraw 的工具表，再去掉其他自带工具的快捷键（F、R、O、T 原来是 tldraw 自己的 frame、矩形、椭圆、文字）；`FigmaToolbar` 只放这 8 个按钮。tldraw 在空白处双击会新建它自己的文字，用 `createTextOnCanvasDoubleClick: false` 关掉。

**怎么画。** 四个工具共用 `tools.tsx` 里的两个状态 `Idle` / `Pointing`：

- 按下后拖动：在按下的位置建一个 1×1 的图层，交给 tldraw 的缩放状态 `select.resizing`（`isCreating`，从右下角手柄拉），拉的时候图层跟着变大，对齐线照常起作用。松手后（`onCreate`）选中它，切回移动工具。文字只拉右边（手柄 `right`）：宽度由拖动定，高度跟着内容，和 Figma 拖出文本框一样（§13.1 的缩放规则把它变成自动高度）。
- 不拖直接点：Frame、矩形、椭圆建一个 100×100 的，左上角在点的位置；文字建一个空的自动宽度文字。
- 文字建好直接进入编辑。什么都没打就离开，§13.3 的规则会把它删掉。用文字工具点在已有的文字上，是编辑那段文字，不新建。
- 新建是一个撤销步骤。

**默认样子**（`create.ts` 的 `newNode`，和 Figma 一样）：

| 图层       | 节点数据                                                                               |
| ---------- | -------------------------------------------------------------------------------------- |
| Frame      | 白色填充，裁剪内容（`clipsContent`）                                                   |
| 矩形、椭圆 | 填充 #D9D9D9                                                                           |
| 文字       | Inter Regular 12，黑色，自动宽度，自动行高（`INTRINSIC_%`，行高像素按 §13.4 的比例算） |

都没有描边和效果，约束是左 / 上，尺寸方式是固定（文字是包裹）。名字按 "Rectangle 1"、"Frame 2" 编号：找画布上同类名字里最大的编号再加 1。节点 id 用 tldraw 图形 id 换个前缀（`new:…`），不会和 Figma 的 `12:34` 撞上。

**文字图层的名字跟着内容走。** Figma 的文字图层有个 `autoRename`：没改过名字时，名字就是内容。新建的文字带 `autoRename: true`；导入的文字没有这个字段，名字和内容一样就当作 true（`engine.ts` 的 `followsText`）。`onChange` 看到内容变了就同步改名字；在图层树里改过名字以后 `autoRename` 变成 false，不再跟着变。

**放进哪个 frame**（`dropTarget`）：从最上层往下找，第一个包含按下位置的 frame，而且这个位置没被外层 frame 的裁剪挡住。组不收新图层，和 Figma 一样；组件和实例当普通 frame（§13 定的），可以放进去。都不符合就放在画布上。

没用 tldraw 自己挑父图形的办法。`createShapes` 不给 `parentId` 时，tldraw 会找"能收子图形"（`canReceiveNewChildrenOfType`）的图形当父图形；可一旦打开这个开关，tldraw 每次拖动、缩放结束时，还会把跑出父图形范围的图形挪进别的图形（`kickoutOccludedShapes`）。这是下一步拖动换父图层要处理的事，现在打开会打乱自动布局。所以 `createLayer` 自己算好父图层和局部坐标传进去，`canReceiveNewChildrenOfType` 保持默认的 false，画笔和箭头还是画在画布上。

**画进自动布局。** 拖的过程中，新图层先设成绝对定位（`layoutPositioning: 'ABSOLUTE'`），不参与排列，留在画的地方。松手时 `finishLayer` 去掉绝对定位，拿它的中心和兄弟的中心比，排进对应的位置（`engine.ts` 的 `flowIndex`），然后自动布局重排。点一下建的图层马上排进去。

踩过的坑：tldraw 的"一次操作结束"回调（§13 的引擎在这里重排）在 `editor.run` 里面也是每改一次就触发一次。一开始的写法是先去掉绝对定位、再算位置，结果第一次修改就触发了重排，图层先被排到最后，再按这个位置算，就总是排在最后。现在先算好位置，节点和顺序在同一次 `updateShape` 里改。

**实测**（2026-10-25，Playwright 在无头 Chrome 里用鼠标，`/canvas?case=page/mobile-login`）：

| 操作                                       | 结果                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 按 R，在 SSO 按钮下面的空白处拖出 80×60    | "Rectangle 1" 放进整页（纵向自动布局），排在 SSO 按钮和 Spacer 之间；Spacer 是"填充"的，从 176 高缩到 100 |
| 按 O，在分隔线左边那段上点一下             | "Ellipse 1" 放进 Divider，排在左边线条和 "or" 之间；Divider 是包裹的，变成 100 高，两条"填充"的线变短     |
| 按 T，在空白处点，打 "Hello figma"，按 Esc | 进入编辑；图层名字变成 "Hello figma"，自动宽度                                                            |
| 按 T 点一下直接按 Esc                      | 空文字被删掉                                                                                              |
| 按 F 在空白处拖出 200×150，再按 R 在里面拖 | "Frame 1" 白色，在画布上；"Rectangle 2" 是它的子图层；撤销一次只撤掉矩形                                  |
| 按 T 拖出 150 宽，打一长句                 | 自动高度，宽 150，折成 3 行                                                                               |
| 按 T 在副标题和输入框之间点，打 "Hi there" | 文字排进整页，第一个输入框下移 31（文字高 15 + 间距 16）                                                  |
| 按 T 点在 "Welcome back" 上                | 编辑这段文字，不新建                                                                                      |
| 按 D 画一笔                                | tldraw 的画笔照常，画在画布上                                                                             |

### 14.2 图层树

**数据。** `layers.tsx` 用 tldraw 的 `computed` 从当前页面读出整棵树：每个图层的 id、名字、图标、是否隐藏、是否锁定、子图层。新旧结果转成 JSON 字符串比较，只有结构、名字、隐藏、锁定变了才重画，拖动、缩放时树不重画。

**顺序。** 和 Figma 的图层面板一样，叠在上面的排在前面，也就是 tldraw 的 `index` 倒过来。导入时 First on top 的 frame 已经把子图层倒过来存了（§4.3），不用另外处理。自动布局默认后面的图层叠在上面，所以纵向排列时最下面的图层在列表最上面，这一点 Figma 也是这样。

**图标**（lucide）：frame（#）、横向 / 纵向自动布局、组（虚线框）、Section、组件、实例、矩形、椭圆、文字、矢量、直线、星形、多边形、布尔运算。tldraw 的画笔和箭头叫 "Drawing" / "Arrow"，改的名字存在图形的 `meta.name`。

**展开。** 打开用例时展开最外层，能看到整页的直接子图层。在画布上选中图层时，它的所有上级自动展开，并滚到那一行。点箭头展开或收起。这两件事用 tldraw 的 `react` 盯着页面最外层和选中的图层来做（`pnpm lint` 不允许在 effect 里直接改 state）。

**和画布联动。**

- 点一行选中，Shift 选中连续的几行，Cmd / Ctrl 加选或取消，点空白处取消选择。点完把焦点还给画布（`editor.focus()`），Delete、Cmd+D、Esc / Enter 这些快捷键照常能用。
- 选中的行是深一点的蓝色，它下面的子图层是浅蓝色。
- 鼠标停在一行上，`editor.setHoveredShape` 让画布上描出这个图层的边框；反过来，鼠标在画布上停在哪个图层上，那一行也描边。
- 双击名字改名，按 Enter 或点别处确定，按 Esc 取消。改名是一个撤销步骤。

**隐藏和锁定。** 行尾有眼睛和锁，鼠标停在行上才显示；已经隐藏或锁定的一直显示。

- 隐藏写进节点数据 `node.visible = false`，`getShapeVisibility` 返回 `hidden`，子图层跟着不画、点不中。和 Figma 一样，隐藏的图层不参与自动布局（`auto-layout.ts` 的 `inFlow`），也不算进组的边界（`engine.ts` 的 `contentBounds`）。树里隐藏的图层和它的子图层变灰。
- 锁定用 tldraw 自带的 `isLocked`：画布上点不中它和它的子图层，树里还能选中。改隐藏、锁定、名字时带 `ignoreShapeLock`，锁定的图层也能改。
- 在 Figma 里本来就隐藏的图层，导入时被跳过了（§4，插件没导出它们的位置和 SVG），所以不在树里，也没法显示出来。

**实测**（同上）：

| 操作                                             | 结果                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| 打开 mobile-login                                | 树里 12 行：整页和它的 11 个子图层，顺序和 Figma 一样               |
| 画布上点 Sign in 按钮，再按 Enter                | 树里 "Primary button" 选中；按 Enter 后它展开，"Sign in" 选中       |
| 点 "Logo" 那一行；鼠标停在 "Welcome back" 那一行 | 画布上选中 Logo；悬停的图层是 Welcome back                          |
| 点 Logo 的眼睛                                   | Logo 不画了，标题从 y 160 移到 88；撤销恢复                         |
| 锁定 "Welcome back"，在画布上点它                | 选中的是整页，不是标题                                              |
| 双击 "Logo" 改成 "Avatar"                        | 名字改了，`autoRename` 是 false；撤销恢复                           |
| 点 "Primary button"，Shift 点第一个 "Input"      | 选中 Primary button、Options、Input 三个；再 Cmd 点 Options，去掉它 |
| 点整页那一行的箭头                               | 收起，只剩 1 行                                                     |

**没做的。** 拖动行来调整顺序、把图层拖进别的 frame，是下一步（用户已定），画布上的拖动也一起做。Figma 图层面板里的键盘操作（上下键换行、左右键展开收起）、右键菜单、按名字搜索都没做。

## 15. 只用开源字体的用例（2026-10-25，用户追加）

用户要求把用到商业字体的用例都去掉，以后补的用例也要避开商业字体（用户追加）。理由：商业字体没有合法的网页版，浏览器只能用后备字体画，差异和我们的渲染没关系，混在平均分里看不出真实水平。

**规则：一个用例只能用 `apps/client/src/figma/fonts.ts` 里 `OPEN_FONTS` 列出的字体。** 这些都是开源许可、能从 npm 装上的字体（`@fontsource/*`）：Inter、Noto Sans SC、Red Hat Display、Poppins、Montserrat、Lato、DM Sans、Urbanist、Lexend、Nunito。要加新字体，先确认许可证允许网页使用、npm 上有和 Figma 同一版本的包（§12.1 的挑法），装上以后再加进清单。

- `scripts/import-cases.ts` 导入时读每个用例 `meta.fonts` 里的字体家族，有不在清单里的就跳过这个用例，打印 `跳过 <目录>：用到不在开源字体清单里的字体 …`。
- 去掉的 21 个用例挪到 `archive/removed-cases/`（不进 git，`removed.json` 记了每个用例用的字体），没有删：

| 稿子                             | 用例数 | 字体                                                                             |
| -------------------------------- | ------ | -------------------------------------------------------------------------------- |
| Google Gemini                    | 7      | Product Sans                                                                     |
| Social App                       | 5      | Circular Std、Proxima Nova、SF Pro Text                                          |
| Bankpick（Banking）              | 5      | SF Pro Display                                                                   |
| FreshGo                          | 3      | SF Pro                                                                           |
| SaaS Framer 的 light-page-mobile | 1      | Switzer（免费，但只能从 Fontshare 手动下载，npm 上没有，按"拿不到"处理，我拍板） |

151 个用例变成 130 个。`FONT_SUBSTITUTES` 里 Product Sans → Google Sans Flex 的近似代替（§6.9）留着，现在没有用例用到。

**还原度**（同一份对比数据，只是去掉 21 个用例重新算）：151 个平均 0.1334%，130 个平均 0.0662%，全部小于 1%，47 个逐像素一致，最大 0.855%（50+ Landing 的 designs-30）。去掉的 21 个原来平均 0.549%。也就是说，平均分里一半的差异来自商业字体。

**对比脚本加了重跑。** 全量跑 130 个用例时，偶尔有一两个用例截图时图片还没加载完（单独跑就正常），比如 Furniture 首页一次是 9.07%，单独跑 0.23%。`scripts/compare.ts` 现在对差异 ≥ 1%（`RETRY_ABOVE`）的用例自动再跑一次，取好的那次。重跑放在并行的一轮全部跑完以后、一个一个跑，打印 `重跑 <目录>：a% → b%`；一开始放在并行里马上重跑，机器还是忙的，Furniture 首页重跑也没好。

## 16. Figma 组件（2026-10-25，用户追加）

用户定的目标（用户追加）：导出所有主组件，重新建立主组件和实例的关联；在 tldraw 里实现组件体系；逐个用例切换到新的组件体系，还原度不能下降。方向按 [probe-components.md](probe-components.md) §6 的方案 A：实例里的图层还是真实图形，实例记覆盖，主组件放单独的"组件"页，不用 tldraw 的绑定。调研里留给用户定的几件事，用户说"中途帮我做决定"，按调研的推荐定了：方案 A；主组件放"组件"页；组件集整套导出，变体超过 60 个的只导用到的。

### 16.1 插件导出主组件

`apps/figma-plugin/code.js` 导出每个用例时，顺带导出它用到的主组件：

1. `findMains`：找出用例里所有实例（包括嵌在实例里的），对每个实例 `getMainComponentAsync()` 拿到主组件。主组件在组件集里时，取整个组件集。
2. 整套组件集也会套着别的组件（比如按钮里的图标），所以导出的主组件再进队列，一直找到没有新的为止。
3. 组件集最多导 60 个变体（`MAX_FULL_SET`），超过的只导用到的变体，拼一个 `partial: true` 的 `COMPONENT_SET`，带上 `componentPropertyDefinitions` 和真正的变体数 `variantCount`。
4. `exportMains`：已经在用例里面的主组件跳过（它本来就在 `rest.document` 里）。其他的用 `exportAsync({ format: 'JSON_REST_V1' })` 导出，放进快照新加的 `mains` 字段（主组件或组件集的 node id → 节点树），`rest.components` / `componentSets` / `styles` 合并进来。主组件里的图层和用例一样收集位置、SVG、图片、字体（`collect`）。
5. 找不到主组件的（库组件没有权限之类）记警告 `找不到主组件：…`。**被删掉的主组件**跳过，记警告 `主组件已删除，按实例原样导入：…`。Figma 里删了主组件，实例还能用，主组件被藏到一个不在 `figma.root.children` 里的内部页面；这种主组件导出来是空壳（没有子图层，位置在 0, 0），实测 E-Learning、50+ Landing、Untitled UI、SaaS Framer 都有。

**隐藏图层也要导出位置。** 以前插件跳过隐藏的图层（§4），可组件属性和变体会把隐藏的图层显示出来，所以现在 `collect` 对隐藏的子树也记位置（`transforms`）和图片，不导 SVG、不收集字体（SVG 要 Figma 渲染，隐藏的图层渲染不出来）。还有一种隐藏是 REST 导出自己丢的：**隐藏的嵌套实例，导出时有时不带子图层**（Furniture 每页的导航栏里有一个），重建时按主组件补上（§16.2）。

`meta` 加了 `mains`（导出的主组件和组件集个数）和 `mainFonts`（主组件里用到的字体）。主组件里的字体只记录，不参与 §15 的字体检查，因为主组件不画在用例的截图里。

**按列表导出。** 插件界面加了第 3 步"按列表导出"：贴一段 `[{"id": "节点 id", "dir": "用例目录"}]`，插件按 id 找到节点（先 `figma.loadAllPagesAsync()`，能跨页面找），按给定的目录导出。用来把已有的用例原样重新导出一遍，目录名不变。每个用例在 `index.json` 里的 `page` 由插件按节点所在页面写，`import-cases` 用它写 `source.page`。

**重新导出的结果**（2026-10-25，Figma 桌面版）：6 套真实稿子 43 个用例全部重新导出；合成用例 87 个里只有 `component/instances` 有实例，它的主组件就在用例里面，不用重导。和重导前的数据比：Figma 渲染的 `expected@2x.png` 逐字节一样；SVG 只差在 Figma 每次生成的渐变 id；个别实例的 `overrides` 多了一条 `width` / `height`（Figma 自己的数据，照收）。快照变大很多：Untitled UI 每页导出 81 个组件集、12346 个节点，`snapshot.json` 40 MB 左右（缩进占一半多），其中用例真正用到的主组件只有 80 个、425 个节点，其余是整套变体。

### 16.2 按主组件重建实例

`apps/client/src/figma/components.ts`（新）把每个实例按"主组件 + 覆盖"重新算一遍：

- **对应关系。** 实例里图层的 id 是 `I<实例 id>;<主组件里图层的 id>`，嵌套的实例再往后接，如 `I9:1;1:3;5:2`。`copyId(实例, 主组件图层)` 拼出来，`templateIdOf` 反过来拆。
- **结构来自主组件。** `rebuildInstance` 沿着主组件的子图层一层层往下，按 id 找到实例里对应的图层。主组件里有、实例里没有的记"少"；实例里有、主组件里没有的记"多"，原样接在后面。
- **每个字段的来源。** 位置和尺寸（`absoluteBoundingBox`、`absoluteRenderBounds`、`relativeTransform`、`size`）永远用实例自己的，因为它们是 Figma 算好的排版结果。其他字段：
  1. Figma 的覆盖记录（`overrides` 里的 `overriddenFields`）列了的，用实例的值。覆盖记录用的字段名和节点字段名不全一样，`nodeFieldsFor` 换算：字号、字体等文字样式对应 `style`，`characters` 对应文字内容那一组，`fills` 和填充样式对应 `fills` + `styles`，`width` / `height` 对应 `layoutSizing*`。
  2. 组件属性管的（`componentPropertyReferences`：`visible`、`characters`、`mainComponent`），用实例的值。
  3. 和主组件一样的，用主组件的值。
  4. 剩下和主组件不一样、又没有记录说明原因的，叫**推断的覆盖**：保留实例的值，并把字段名补进这个实例的 `overrides`。这样重建后每个实例都能完整地读成"主组件 + 覆盖"，后面同步只看这一份记录。
- **嵌套实例。** 嵌套实例自己的覆盖（主组件里设好的）也算覆盖，一路往下传。**换过主组件的嵌套实例**（instance swap 或切了变体，`componentId` 和主组件里那一层不一样）改用它自己的主组件重建；它本身的字段和新主组件一样、或者和原来那个位置一样，都不算推断。实测 Untitled UI 里换过的嵌套实例，名字 886 个跟新主组件、218 个保留原来的名字（原来改过名），`layoutAlign` / `layoutGrow` 这些"在父图层里怎么排"的字段全都跟原来的位置。
- **补隐藏的嵌套实例。** 实例里找不到的图层，如果它的父图层是隐藏的（§16.1 说的 REST 导出丢子图层），就从主组件复制一份，按父图层的位移挪过去，记"补上"。
- **被删掉的主组件**：主组件是空壳、实例却有子图层时，当作找不到主组件，实例原样保留。
- **不算的字段**：`id`、`children`、`overrides`、交互和原型相关、`pluginData`、变量绑定，以及 `background` / `backgroundColor`（`fills` 的旧写法，跟着 `fills` 变）和 `layoutVersion`（Figma 内部字段）。

重建的结果和 Figma 展开的实例逐字段一样（位置用实例的，其余字段要么相同、要么来自实例），所以画出来不会变，还原度不受影响。

**检查脚本。** `cd apps/client && npx tsx scripts/check-components.ts [目录片段]`（新）对所有用例跑一遍重建，打印每个用例和总计：最外层实例和换过主组件的实例连上了几个、图层数、字段各来自哪里、推断了哪些字段、多和少的图层数。

**结果**（2026-10-25，6 套真实稿子 43 个用例重新导出后）：

| 项                      | 数                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| 实例（最外层 + 换过的） | 2025 个，连上 1671；连不上 354 个（主组件被删了的，或嵌在这些实例里的）；换过主组件 333          |
| 图层                    | 8203 个                                                                                          |
| 字段                    | 158164 个：主组件 149073，覆盖记录 8104，组件属性 917，推断 70                                   |
| 多 / 少的图层           | 0 / 0；补上隐藏嵌套实例的图层 12 个                                                              |
| 推断的字段              | `strokes` / `strokeWeight` / `styles` 各 16，`uniformScaleFactor` 10，`layoutSizing*` 10，其他 2 |

推断的字段从一开始的 1650 个降到 70 个，降的那部分是三类规则没写对：换过主组件的嵌套实例要和新主组件比（330 个 `componentId`、218 个 `componentProperties`……）；`fills` 的覆盖也覆盖了 `styles`；`background` 这些派生字段不比。`uniformScaleFactor` 是缩放过的实例（调研里说的 37 个那类），整个实例按比例缩放，Figma 不把它算进覆盖。

### 16.3 导入：实例、隐藏图层和"组件"页

`apps/client/src/figma/to-shapes.ts` 的 `snapshotToShapes` 先用 `rebuildTree(snapshot.rest.document, indexMains(snapshot))` 把页面上的实例重建一遍（§16.2），再转成图形。重建后每个实例的 `overrides` 是完整的，编辑时只看这一份记录。

**隐藏的图层也建图形。** 以前隐藏的图层（`visible: false`，或者在隐藏的父图层里）直接跳过。现在组件属性和变体会把隐藏的图层显示出来，所以要建图形。这些图形本来就不显示：tldraw 的 `getShapeVisibility` 用 `figmaShapeVisibility`（§14.2）把它们藏起来，也点不中，所以画出来和以前一样。几个细节：

- 隐藏的矢量没有 SVG（§16.1，Figma 渲染不出隐藏的图层）。这时按 `transforms` 或包围盒放一个 `svg: ''` 的占位图形，等它被显示出来时再说（`placement(node, type, hidden)`）。
- "缺少位置或 SVG"的警告和"`absoluteRenderBounds` 为空就跳过"只对看得见的图层生效。
- 隐藏的蒙版图层不当蒙版用；`clip.ts` 的 `isOpaqueBox` 对隐藏的图层返回 false，不拿它去裁下面的图层（§4.1）。

**主组件放在"组件"页。** `snapshotToShapes` 加了 `mains` 选项：打开时把 `snapshot.mains` 里每个主组件或组件集转成图形，按导出顺序从左往右排，间隔 80（`MAIN_GAP`），一行排满 4000（`MAIN_ROW`）换行。结果里多一个 `mains` 数组，最上层的图形没有 `parentId`。`apps/client/src/figma/editor.ts` 的 `putSnapshot` 先删掉第一页以外的页面，在第一页建用例的图形，再新建 id 为 `page:components`（`COMPONENTS_PAGE`）、名字叫"组件"的页面，把主组件放上去。用例里本来就有的主组件（比如 `component/instances`）留在原地，不挪到"组件"页。

**截图对比时不建"组件"页。** `/canvas?shot=1`（对比脚本用的地址）传 `{ mains: false }`，只建用例本身的图形，省时间也省内存（`apps/client/src/pages/canvas.tsx` 的 `showSnapshot`）。

**一页最多的图形数调到 10 万。** tldraw 默认一页最多 4000 个图形（`maxShapesPerPage`），超过就不让建。它数的是**当前页**的图形数，所以在第一页建"组件"页的图形时也按第一页算。Untitled UI 的"组件"页有 11892 个图形，超过 4000 就一个都建不出来。`canvas.tsx` 的 `options` 里改成 `maxShapesPerPage: 100_000`。实测（2026-10-25，Chromium）：Untitled UI dashboards-desktop 打开要 5.5 秒（"组件"页 11892 个图形），Golio 的"组件"页 6390 个图形。

### 16.4 tldraw 里的组件引擎

代码在 `apps/client/src/figma/editing/instances.ts`（新），由 `engine.ts` 里的副作用接进来。数据还是只有 `props.node`：

- **主组件**：`type: 'COMPONENT'` 的图形，在哪一页都行。组件集是 `COMPONENT_SET`，变体是它下面的主组件，名字是 `属性=值, 属性=值`（`variantProps` 解析）。
- **实例**：`type: 'INSTANCE'` 的图形，`componentId` 指向主组件的 node id，带 `componentProperties` 和 `overrides`。
- **实例里的图层**：普通图形，node id 是 `I<实例 id>;<主组件里图层的 id>`，靠 id 和主组件里的图层对上（`copyId`）。嵌套的实例也是实例，自己再往下接。

**1. 改实例里的图层：记覆盖。** `onChange` 里调 `recordOverride`：比较改前改后的 node（`changedFields`），把变了的字段加进**最外层**实例的 `overrides` 里这个图层那一条。`id`、`type`、`overrides`、`componentId`、`componentProperties` 这些不算覆盖（`NOT_OVERRIDES`）。文字改内容时 tldraw 会顺带把图层名改成文字，这时 `name` 不算覆盖。

**2. 改主组件：同步到所有实例。** 主组件里的图形改了、新建了、删了，分别记进 `mainEdits` 的 `changed`、`created`、`deleted`。一次操作结束时（`flush`，tldraw 的 operation complete）调 `syncInstances`，对这个主组件的每个实例（包括嵌在别的实例里的）：

- **改了**：把变了的字段抄到实例里对应的图层上，跳过三类：这个实例覆盖了的字段、组件属性管的字段（`componentPropertyReferences`）、`exposedInstances` 这类不该抄的（`NOT_SYNCED`）。位置、尺寸、旋转只有在实例图层原来和主组件**改之前**一样时才跟着改，这样实例自己的排版不会被冲掉。图形上 node 以外的数据（`svg`、`images`、`imageSizes`、`maskPath`、`flipX`）也一起抄。换了父图层、换了顺序，实例里也跟着换。
- **新建了**：在实例里对应的父图层下面建一份，id 用 `copyId`，蒙版指向也换成实例里的那一份。
- **删了**：删掉实例里对应的图层。

**3. 引擎自己的写入不算覆盖。** 同步、换主组件这些是引擎自己改的，改之前把图形 id 放进 `quiet`，`onChange` 看到就不记覆盖、不跑约束。`flush` 开头清空 `quiet`。

**4. 撤销和重做。** 同步写进去的图层改动和用户的改动在同一步历史里，撤销时一起回去。`patchHistory` 把 `editor.undo` / `redo` 包了一层，重放期间（`replaying`）不记覆盖、不记主组件改动、不改 id，免得重放出来的改动又被当成新的编辑。

**5. 跟 Figma 一样的限制。**

- 实例里的图层不能拖动、缩放、旋转：`registerBeforeChangeHandler` 里的 `keepInstanceLayout`，在 `select.translating` / `resizing` / `rotating` 时把选中的、在实例里的图层的位置、尺寸、旋转、父图层和顺序还原。
- 删实例里的图层等于隐藏它：`patchDelete` 把 `editor.deleteShapes` 包了一层，实例里的图层改成 `visible: false`，记一条 `visible` 覆盖。整个实例、主组件里的图层照常删。
- 新建的图层不会放进实例：`create.ts` 的 `dropTarget` 跳过实例和实例里面的 frame。

**6. 复制、粘贴、Duplicate。** 复制出来的图层 node id 和原来的一样，不改就会有两个图层抢一个 id，覆盖和同步都会对错图层。`registerBeforeCreateHandler` 里的 `renameOnCreate` 处理：

- id 已经有人用了，就发一个新的（`newNodeId()`，形如 `n<时间>:<序号>`）。
- 下面的图层跟着换前缀：`I<旧实例>;1:2` 变成 `I<新实例>;1:2`。按最长的已改名前缀换（`renamed`），所以单独复制一个嵌套实例时，它下面的图层跟着它自己的新 id。
- 粘贴一个主组件，得到的是它的实例（`instanceNode`），下面的图层变成实例里的图层。Figma 也是这样。
- `overrides` 里的图层 id 一起换。

**这要求父图层先建、子图层后建。** tldraw 的 `duplicateShapes` 是倒着建的（先子后父，`[...shapeIdSet].reverse()`），子图层建的时候还不知道父图层换成了什么 id，结果子图层各自拿到一个不相干的新 id，复制出来的实例不再跟主组件同步（2026-10-25 浏览器里实测发现）。`patchCreate` 把 `editor.createShapes` 包了一层：每次调用先清空改名表 `renames`，再把传进来的图形按"父图层在前"重新排（`parentsFirst`）。tldraw 一次 `createShapes` 只写一次 store，前面的图形写进去后，后面的图形在 before-create 里就能查到它。

**7. 实例上的操作**（`instances.ts`，面板按钮调用，见 §16.5）：

| 操作                            | 做法                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 生成实例 `createInstance`       | 在主组件右边 40 处放一个实例，`componentProperties` 用属性定义里的默认值（`defaultProperties`），复制主组件的图层（`cloneLayers`）                                                   |
| 切变体 `setProperty`（VARIANT） | 在组件集里找这个属性等于新值的变体；有几个时，选其他变体属性和现在一样最多的那个；然后 `swapMain`                                                                                    |
| 布尔、文字属性 `setProperty`    | 改 `componentProperties`，再按 `componentPropertyReferences` 改图层的 `visible` / `characters`（`applyProperty`）                                                                    |
| 换实例 INSTANCE_SWAP            | 图层的 `componentPropertyReferences.mainComponent` 指向这个属性时，`swapMain` 换成新主组件，不保留覆盖。面板里只显示，不能改（Figma 给的候选是组件 key，导出的数据里对不上 node id） |
| 换主组件 `swapMain`             | 删掉实例里的图层，按新主组件重新复制；原来的覆盖按"名字路径"（`/Frame/Label` 这样）搬到新图层上；实例原来和旧主组件一样大时，尺寸跟新主组件走；最外层实例的覆盖记录一起更新          |
| 重置 `resetInstance`            | 按自己的主组件 `swapMain`，不保留覆盖；布尔、文字属性的值保留并重新应用（我拍板：属性值是用户在面板里设的，不算"改过的地方"）                                                        |
| 分离 `detachInstance`           | 实例变成 `FRAME`，去掉 `componentId` / `componentProperties` / `overrides`，图层和 id 不动；里面的嵌套实例还是实例。只有最外层实例能分离                                             |
| 新建组件 `createComponents`     | 选中的 frame 变成 `COMPONENT`。只有不在实例里的 `figma-frame` 能变（`canBecomeComponent`）                                                                                           |
| 跳到主组件 `goToMain`           | 切到主组件所在的页面，选中它，缩放过去                                                                                                                                               |

**测试。** `instances.test.ts`（新）在 Node 里建一个真的 tldraw `Editor`（只补了几个 DOM 桩：`document.createElement`、`requestAnimationFrame`、`devicePixelRatio` 等），用 `putSnapshot` 放一个小用例（一个主组件和它的实例、一个两个变体的组件集和实例、一个普通 frame），测上面 1～7 的主要行为，12 条。

### 16.5 面板、图层树和快捷键

- **紫色。** 选中的全是主组件、组件集或实例时，选框变成 Figma 的紫色 `#9747ff`：`installComponentColors` 给 tldraw 的容器加 `figma-component-selected` 类，`figma.css` 在这个类下改 `--color-selection-stroke` / `--color-selection-fill`。图层树里这些图层的图标和名字也是紫色（`layers.tsx` 的 `Layer`），面板顶上实例的名字也是紫色。
- **页面切换。** 图层树上面加了页面标签（`PageTabs`），有两页以上时显示，点了切页面。现在就是用例页和"组件"页。
- **"实例"一节**（`panel.tsx` 的 `InstanceSection`，选中一个实例时显示）：主组件或组件集的名字（紫色）；每个组件属性一行，变体是下拉框、布尔是勾选框、文字是输入框，换实例只显示换成的组件名；覆盖了几个字段；按钮"跳到主组件""重置所有覆盖""分离实例"（嵌套实例没有"分离实例"）。主组件不在文件里（库组件或已删除）时写明。
- **"组件"或"组件集"一节**（`MainSection`，选中主组件或组件集时）：属性定义列表（变体几个、布尔、文字、换实例）；主组件还显示文件里有几个实例和"生成实例"按钮。
- **新建组件。** 选中能变成组件的 frame 时面板显示"新建组件（⌥⌘K）"（`NewComponentSection`）；快捷键 ⌥⌘K（Windows 上 Ctrl+Alt+K）是 `tools.tsx` 里的 `figma-create-component` 动作，和 Figma 一样。
