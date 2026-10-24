# Figma 还原到 tldraw：技术实现

> 相关：[模块说明](README.md) · 施工计划 [`docs/施工计划.md`](../../../docs/施工计划.md)

## 1. 链路和快照格式（2026-10-24）

```
Figma 插件（apps/figma-plugin/）
   │  生成测试用例 → 导出 zip → 解压成仓库根目录的 cases/
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

`cases/` 和 `reports/` 都不提交进 git（图片和截图体积大），在 `.gitignore`、`.oxlintrc.json`、`.oxfmtrc.json` 里都排除了。开发服务器通过 `apps/client/vite-plugins/serve-cases.ts`（在 `vite.config.ts` 里注册）把 `cases/` 提供成 `/cases/...`，只认 `cases/` 里面的文件，路径里带 `..` 跳出去的一律 404。

`/canvas` 页面（2026-10-24）：左侧是按分类分组的用例列表，当前用例写在网址里（`/canvas?case=fill/solid`）；顶部工具条可以把 `expected@2x.png` 按 frame 尺寸盖在画布上，"半透明"用 50% 透明度，"差异"用 `mix-blend-mode: difference`（完全一样的地方是黑色）。原图放在 tldraw 的 `OnTheCanvas` 层，跟着镜头一起移动缩放。没有 `case` 参数时显示 `fixtures/hello.json`。

### 1.2 snapshot.json

| 字段         | 内容                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `rest`       | `exportAsync({ format: "JSON_REST_V1" })` 的原始结果，节点树在 `rest.document`                                                               |
| `svgs`       | `{ [nodeId]: svg 字符串 }`：VECTOR、BOOLEAN_OPERATION、STAR、POLYGON、LINE、ELLIPSE 单独导出的 SVG。布尔运算整体导出一个，不再导出它的子节点 |
| `transforms` | `{ [nodeId]: { m, w, h } }`：插件 API 的 `absoluteTransform`（2×3 矩阵）和节点本身的宽高（2026-10-24 加，见 §4.2）                           |
| `meta`       | 用例名、尺寸、字体、`images`（`{ [hash]: 相对路径 }`）、`imageSizes`、`masks`、警告                                                          |

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
4. 上下层：同一个父节点下按 `children` 的顺序排，Figma 里第一个子节点在最下面。
5. 位置见 §4.2。

### 4.1 透明度

图形的 `opacity` = 节点的 `opacity`（REST 里没有就是 1）。tldraw 会自己乘上祖先的透明度（§2），所以不要再手动乘。

例外（2026-10-24，第一份报告发现）：`figma-vector` 的 `opacity` 固定是 1。Figma 导出的 SVG 已经把节点自己的透明度写进去了（比如 `<circle opacity="0.5">`），图形上再乘一次就变成 0.25。混合模式不会写进 SVG，还是由图形自己处理（§6.6）。

已知限制：Figma 的组 / frame 透明度是"先把子节点画在一起，再整体变淡"，tldraw 是"每个子图形各自变淡"。子节点互相重叠时，重叠的地方颜色不一样（`container/group-opacity` 右边那组）。要完全一致就得把整个子树画进一个图形，属于架构改动，先记下来。

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

虚线用 `stroke-dasharray`，渐变描边用 §6.1 的渐变。四边粗细不同（`individualStrokeWeights`）用 CSS `border` 分别设四边。

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
- **Inter 必须用 3.x 版本**（2026-10-24，第一份报告发现）：Figma 用的是 Inter 3.19，新版 Inter 4（`@fontsource/inter` 5.x）的字宽不一样，24px 的 "The quick brown fox jumps" 宽 306.9px，Figma 是 305px，3.19 量出来是 304.6px。所以锁定 `@fontsource/inter@4.5.15`（里面是 Inter 3.19）。也试过 Inter 4 的光学尺寸（`opsz`），24px 时只有 292.5px，更不对。
- Inter 3.19 的字体包没有静态斜体。Figma 的 Inter Italic 是正体倾斜 10°，所以斜体改用同一个包里带倾斜轴的可变字体 `InterVariable`，CSS 写 `font-style: oblique 10deg`。
- 行高一律用 REST 算好的 `lineHeightPx`；字间距用 `letterSpacing`（像素）。
- `textAutoResize` 为 `WIDTH_AND_HEIGHT` 时不换行（`white-space: pre`），其他情况按节点宽度换行。
- 垂直对齐用 flex 的 `justify-content`。
- 混合样式：按 `characterStyleOverrides` 把文字切成几段，每段套 `styleOverrideTable` 里的样式。
- 段落间距：每个换行符切一段，段与段之间加 `paragraphSpacing`。
- 截断：`maxLines` 用 `-webkit-line-clamp`；单行用 `text-overflow: ellipsis`。

### 6.5 圆角

`cornerRadius` 或 `rectangleCornerRadii`（四个角不同）→ CSS `border-radius`。相邻两个圆角之和超过边长时，CSS 会把所有圆角按同一比例缩小；`geometry.ts` 的 `clampRadii()` 用同样的规则算 SVG 描边和裁剪路径，保证三处一致。Figma 遇到超大圆角也是缩小（`radius/pill-clamped` 用例）。

### 6.6 混合模式

节点的 `blendMode` 写在图形内容的 `data-figma-blend` 属性上，全局 CSS 用 `.tl-shape:has(> [data-figma-blend=…])` 把 `mix-blend-mode` 加到外层 `div.tl-shape` 上（原因见 §2）。

## 7. 对比脚本（2026-10-24）

`apps/client/scripts/compare.ts`，命令 `pnpm --filter @figma-to-tldraw/client compare [用例…]`：

1. 读 `cases/index.json`，可以只跑一部分（`compare fill/solid text/*`）。
2. 每个用例打开 `/canvas?case=<dir>&shot=1`，`deviceScaleFactor: 2`。截图模式隐藏 tldraw 界面、左侧列表、选中框，把用例放在画布左上角、缩放 100%，避开右下角水印。
3. 等页面把 `window.__figmaReady` 设成 `true`（图形、字体、图片都加载完）。
4. 只截用例 frame 那一块（宽高 = 用例尺寸 × 2），和 `expected@2x.png` 用 pixelmatch 对比，存差异图。尺寸不一样时不比较，记为 100%。
5. 输出到 `reports/fidelity/<时间>/`：`index.html`（按差异从大到小排，每行三张图）、`results.json`，每个用例的 `expected.png`、`actual.png`、`diff.png`。`reports/fidelity/latest` 指向最新一次。

差异百分比 = pixelmatch 判为不同的像素数 ÷ 总像素数，阈值 `threshold: 0.1`（pixelmatch 默认），开着抗锯齿检测。

实现细节（2026-10-24）：

- 截图模式（`&shot=1`）：不显示左侧列表和工具条，`<Tldraw hideUi>`，画布背景改成纯白（`figma.css` 里的 `.figma-shot`）。镜头固定在 `(40, 40)`、缩放 100%，所以 frame 在页面上的位置是 `(40, 40)`。
- 浏览器窗口 = 用例尺寸 + 四周 40 + 右边多 200、下边多 100，右下角的 tldraw 水印落在截图区域外面。
- `expected@2x.png` 里 frame 外面（比如圆角外）是透明的，对比前先把它叠到白底上，和截图的白色画布一致。
- "准备好了"的判断在 `load.ts` 的 `waitForAssets`：用 `document.fonts.load` 按每段文字的字体和内容加载字体（Noto Sans SC 是按字符分包的，要带上文字才会加载对的包），图片全部 `decode()` 完，再等 `document.fonts.ready` 和两帧。
- 4 个页面并行截图，每个用例新开一个页面。

## 8. 风险

| 风险                                              | 应对                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| 组透明度：子图形分别变透明，重叠处比 Figma 深     | 先当已知差异；差太多时考虑把那一小块合成一个图形来画（架构改动，先问用户） |
| 混合模式、背景模糊被 `.tl-shape` 的层叠上下文隔开 | §6.6 的做法；实测不行再想办法                                              |
| 浏览器和 Figma 的字体渲染、换行不同               | 用同样的字体文件；剩下的细微差异接受                                       |
| Tailwind 的样式重置影响渲染                       | 渲染组件里把样式写全，不依赖浏览器默认值                                   |
| 平滑圆角（iOS 风格）CSS 画不出来                  | 用 SVG 路径近似，或接受差异                                                |
