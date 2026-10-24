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

| 风险                                                                                                | 应对                                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 组透明度：子图形分别变透明，重叠处比 Figma 深                                                       | 上层是不透明简单形状时，把下层被盖住的部分裁掉（§4.1，已做）；其他情况要把那一小块合成一个图形来画（架构改动，先问用户） |
| 混合模式、背景模糊被 `.tl-shape` 的层叠上下文隔开                                                   | §6.6 的做法；实测不行再想办法                                                                                            |
| 浏览器和 Figma 的字体渲染、换行不同                                                                 | 用同样的字体文件；剩下的细微差异接受                                                                                     |
| Tailwind 的样式重置影响渲染                                                                         | 渲染组件里把样式写全，不依赖浏览器默认值                                                                                 |
| 平滑圆角（iOS 风格）CSS 画不出来                                                                    | 用 SVG 路径近似，或接受差异                                                                                              |
| 稿子用了没有网页版的字体（如 Product Sans）                                                         | 报"缺字体"警告（§9.6）；有近似的开源字体时用它代替（§6.9），否则用后备字体；要完全一致只能由用户提供字体文件             |
| 图片滤镜用的是 Figma 渲染好的图（§6.8）：在 tldraw 里改不了滤镜参数；大照片每种滤镜多一张 PNG       | Demo 不改滤镜，先接受；以后要改再按 §6.8 记下的规律自己画                                                                |
| 展示页的 Figma file key 写死在代码里（§10.1），换了文件或重新复制就失效；链接只对用户自己的草稿有效 | 换文件时改 `FIGMA_FILES`；以后可以试插件的 `figma.fileKey`（要开 `enablePrivatePluginApi`，未验证）                      |
| 差异归因按轴对齐的框算（§10.2），旋转、异形节点和跑出框的文字会算到别的节点上                       | 只用来看"大概在哪"；要精确再按真实形状算                                                                                 |
| 展示页的分组说明（§10.3）是手写的，渲染规则改了原因会变                                             | 改规则、重新考试后同步改 `groups.ts` 里的说明                                                                            |
| 商业字体（Circular Std、Proxima Nova、SF Pro）没有合法的网页版，用后备字体画（§12.1）               | 先接受，展示页写明原因；要更像可以找开源近似字体代替（§6.9），或让插件把这些文字导成轮廓（插件和转换都要改，先问用户）   |
| 字体版本靠实测比值挑出来（§12.1），`@fontsource` 升级可能换掉字体版本                               | DM Sans 锁死 4.5.9、Inter 锁死 4.5.15；升级字体包后重跑全量对比                                                          |

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
- 插件导出的数据里没有 file key：插件 API 的 `figma.fileKey` 只给私有插件，要在 manifest 里开 `enablePrivatePluginApi`，没试。三份文件的 key 是从 Figma 桌面版的本地设置 `~/Library/Application Support/Figma/settings.json` 读到的（打开着的标签页 `windows[].tabs[]` 的 `path` 是 `/file/<key>`，`title` 是文件名），写死在 `apps/client/src/showcase/sources.ts` 的 `FIGMA_FILES`。按文件名对上：每条用例的 `source.figmaFile`，没有 `source` 的（插件生成的 79 个）用 `index.json` 顶层的 `figmaFile`。
- 两份社区稿子是复制到用户草稿里的副本，节点链接打开的是副本，只有用户自己能看；所以另外给一个"社区原稿"按钮，指向社区页面（Untitled UI `community/file/1020079203222518115`，Gemini `community/file/1346359039607478680`）。
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
- 说明：图片滤镜组和两份真实稿子各一段，内容取自 [verification.md §6](verification.md#6-真实稿子考试2026-10-24) 的结论；两张留作考试的稿子各加一句"修规则时没看过它的差异图"。说明只写自动算不出来、已经查清楚的原因；**改了渲染规则、原因变了时要同步改这里**（见 §8）。

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

| 章节                | 内容                                                                      | 出处                                                      |
| ------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| 开头                | 一句话核心思路 + 最新一次对比的四个数字                                   | 数字实时读 `results.json`（`loadLatestReport()`），不写死 |
| 1. 整条链路         | 插件 → `cases/` → 转换 → tldraw 画布 → 对比，五步                         | §1                                                        |
| 2. 每个节点一个图形 | 四种自定义图形的表 + 节点树演示（下面）                                   | §3、§4                                                    |
| 3. 几个关键做法     | 自己写插件、照着 Figma 画、子图形自己裁剪、矩阵算位置、算不准的交给 Figma | §1.2、§5、§4.2、§6.8                                      |
| 4. 怎么量"像不像"   | Gemini 一页的 Figma 图 / tldraw 截图 / 差异图三联，四条要点               | §7、§9.4、§10.2                                           |
| 5. 怎么一步步变像   | 79 个单项用例 → 按特性修 → 真实稿子考试 → 再修、留两页只考不调            | verification.md §4～§6                                    |
| 6. 找到的几条规律   | Inter 版本、自动行高、文字基线、虚线、0.125px 偏移、对比度单位            | §6.2、§6.4、§6.8、§7                                      |
| 7. 还做不到的       | 组透明度、没有网页版的字体、滤镜参数、缩放旋转、Demo 不做的事             | §4.1、§6.9、§8                                            |

第 4 节的三张图直接用最新报告里的 `expected.png`、`actual.png`、`diff.png`（`reportUrl()`），所以要先跑过对比。除了开头的四个数字，其余数字都是历史结果，写死在页面里；**这几节是 tech.md、verification.md 的摘要，改了相关做法时要一起改**（见 §8）。

**节点树演示**（`apps/client/src/showcase/node-tree-demo.tsx`（新）的 `NodeTreeDemo`）：左边是 `page/mobile-login` 的 Figma 节点树（25 个节点，四种图形都有），每行写着"Figma 类型 → tldraw 图形类型"；右边是一个真的 `<Tldraw>`，用 `putSnapshot()` 画上这个用例，选择工具，镜头按画布大小缩放、水平居中（最大 1 倍）。

- 点左边一行 → `editor.select(图形 id)`；鼠标移上去 → `editor.setHoveredShape()`，画布上出现悬停框。
- 在画布上点图形 → 用 `useValue` 订阅选中的图形，左边对应的行高亮并滚到可见处。
- 图形类型也用 `useValue` 从画布里读（`editor.getShape(shapeIdFor(…))?.type`），不在页面里另写一份映射；没有对应图形的节点（比如布尔运算的子节点）显示"—"、不能点。
- 可以拖动图层（子图层跟着父图层走），"复位"重新画、重设镜头。画布背景用 tldraw 默认的浅灰，不像展示页那样设成白色，这样白底的 frame 能看出边界。

## 12. 再加 8 套真实稿子（2026-10-25，用户追加）

两套真实稿子不够（用户追加："把真实稿子堆到 10 套"，偏手机 App 和落地页）。又从 Figma 社区复制了 8 份免费文件，导出 33 页，合进 `cases/real/`，一共 151 个用例。文件名单、file key 和社区链接在 `apps/client/src/showcase/sources.ts` 的 `FIGMA_FILES`（§10.1）。

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
