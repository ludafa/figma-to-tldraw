---
name: skia-engine
title: 自研 Skia 画面引擎
description: 用自己写的 CanvasKit（Skia 编译成 WebAssembly，跑在 WebGL 上）画面引擎替换 tldraw：apps/client/src/engine/ 里和 tldraw 同名同用法的 API（Editor、ShapeUtil、createShapeId、getIndices、StateNode、react / computed / atom、useEditor / useValue、<SkiaCanvas> 对应 <Tldraw>）；自己的信号、store、撤销历史、分数索引、几何；渲染层（canvaskit.ts 加载、fonts.ts 按 @font-face 懒加载字体和共用的 FontCollection、resources.ts 图片（浏览器 createImageBitmap 解码、按内容去重、按缩放取 1/2^k 的档位，image-size.ts）和 SVG 缓存、svg.ts 把 Figma 导出的 SVG 翻成 Skia 绘制、瓦片缓存、选框层）；Figma 图形的 Skia 画法（figma/skia/：填充、渐变、图片、描边、虚线、阴影、背景模糊、文字按 Figma 规则逐行放基线、font-metrics.json 和生成它的 scripts/font-metrics.ts）；还原度目标（每个用例差异 < 1%）和 4 项操作 ≥ 60fps 的性能目标与测法（scripts/bench.ts，也能测 /demo）；总览 Demo 页 /demo（全部 175 个用例、22100 个图形铺在一张画布上，?copies=N 重复，demo/layout.ts、demo/load.ts、标签层）。改画面引擎、查渲染和 Figma 不一致、查卡顿或内存（wasm 堆涨满）、改 /demo 时来读。
changes: [2026-10-27]
status: 已上线
code:
  - apps/client/src/engine/
  - apps/client/src/figma/skia/
  - apps/client/src/demo/
  - apps/client/src/pages/demo.tsx
  - apps/client/scripts/bench.ts
  - apps/client/src/figma/font-metrics.json
  - apps/client/scripts/font-metrics.ts
---

# 自研 Skia 画面引擎

原来的 Demo 用 tldraw 3.x 当画布，每个 Figma 节点是一个 tldraw 自定义图形，用 HTML / CSS / SVG 画（见 [Figma 还原到 tldraw](../figma-to-tldraw/README.md)）。这次把画布换成自己写的引擎：数据层、编辑器和工具状态机照着 tldraw 的 API 重写一份（名字、参数、用法都一样，现有的编辑代码和测试基本只改 import），画面用 CanvasKit 在一个 WebGL `<canvas>` 上画。Figma 的填充、描边、阴影、文字直接翻成 Skia 的绘制命令，不再经过浏览器的 CSS 排版。目标是 175 个用例每个和 Figma 截图的差异都小于 1%，平移、缩放、自由拖动、自动布局里拖动排序这 4 项操作都不低于 60fps（用户拍板）。

结果（2026-10-27，实测）：175 个用例全部小于 1%（[verification.md §4](verification.md#4-各次实际结果)）；4 项操作在最大的几页稿子上平均都在 220fps 以上，只有刚开始缩放或拖动的第一两帧偶尔超过 33ms；`tldraw`、`modern-screenshot` 依赖已经删掉，`/canvas`、`/showcase`、`/how-it-works`、`/report`、`/import` 都跑在本引擎上。施工记录看 [plan.md](plan.md)。

2026-10-28 加了总览 Demo 页 `/demo`（用户追加）：175 个用例、22100 个图形放在一张画布上，约 12 秒加载完，wasm 堆 161～193MB；4 项操作在整面墙和放大到单个用例时都是 60fps（显示器 60Hz）；为它改了引擎的图片解码、字体集合、瓦片补画和按节点 id 找图层，全量对比仍是 175 / 175 小于 1%，平均 0.155%（[verification.md §4](verification.md#4-各次实际结果)）。

## 关键决定

- 自研引擎的 API 和 tldraw 保持一致（`Editor`、`ShapeUtil`、`StateNode`、`createShapeId`、`getIndices`、`react` / `computed` 等），这样 `figma/editing/` 里 3000 多行编辑代码和它们的测试只换 import 就能复用（用户拍板"保持与 tldraw 一致的 api 设计"，见 [tech.md §1](tech.md#1-选型2026-10-27)）
- 渲染用 CanvasKit 0.41.1 + WebGL，参考 `/Users/oliver/code/webgl-figma-tldraw` 的做法（用户指定参考），没选 PixiJS、手写 WebGL 和 Canvas 2D（见 [tech.md §1](tech.md#1-选型2026-10-27)）
- 每个图形的绘制录成 `SkPicture` 缓存，按 props 对象是否变化判断要不要重录；画面再按 512 设备像素的瓦片缓存，平移只贴图，拖动只重画脏矩形（见 [tech.md §5](tech.md#5-渲染2026-10-27)）
- Figma 导出的 SVG 自己解析、翻成 Skia 绘制，不走浏览器：滤镜链、亮度蒙版、图片图案、角度渐变、背景模糊都有对应写法（见 [tech.md §5.3](tech.md#53-svg-翻成-skia2026-10-27)）
- 文字只借 Skia 的段落排版断行和整形，每一行的基线按 Figma 的规则自己算（OS/2 typo 上下沿、大字只往上撑、按 1 倍整像素取整）；typo 指标 CanvasKit 读不到，用 `scripts/font-metrics.ts` 从字体文件里提前抽成 `font-metrics.json`（见 [tech.md §7.2](tech.md#72-文字2026-10-27)）
- 组透明度、混合模式、图层模糊都作用在整棵子树上（`saveLayer`），和 Figma 一致；tldraw 版为了绕开"透明度逐个图形乘"做的裁剪补丁（`clip.ts` 的 `isOpaqueBox`）和截图偏移 `TLDRAW_LAYER_OFFSET` 都不要了（见 [tech.md §7.4](tech.md#74-和-tldraw-版的差别2026-10-27)）
- 工具照旧：选择、抓手、Figma 的新建工具，以及 tldraw 版保留的画笔、箭头（用户定的，换成本引擎的简化版，见 [product.md §5](product.md#5-范围与非目标)）
- 拖动自动布局排序时"被拖的图层在最上面、兄弟滑过去"由场景渲染器画（`setLifted`、`setSlideMs`），数据里的位置一步到位（2026-10-27，见 [tech.md §5.8](tech.md#58-拖动时的抬起和滑动2026-10-27)）
- `/import` 的浏览器内对比不再截 DOM，直接从 Skia 导出像素（`exportArea`），背景模糊也能对比了（2026-10-27，见 [tech.md §5.7](tech.md#57-导出一块区域的像素2026-10-27)）
- 图片不在 CanvasKit 的 wasm 堆里解码：交给浏览器 `createImageBitmap`，按内容去重，按屏幕上的大小解码原图的 1/2^k（最小 256px），和 Figma 的高低清两档、tldraw 的 `TLAssetStore.resolve` 同一思路；切图、GPU 纹理压缩、预生成缩略图文件都没做（2026-10-28，见 [tech.md §5.1](tech.md#51-资源enginerenderresourcests)）
- 所有段落共用一个 `FontCollection`，变量轴只给可变字体：原来每建一个段落都克隆一份字体，`/demo` 上 wasm 堆涨满 2GB（2026-10-28，见 [tech.md §5.2](tech.md#52-字体enginerenderfontsts)）
- 瓦片按 128 × 128 的片补画，每片 `flush` 一次，脏块和新瓦片共用每帧 8ms 预算，缩放中只给 40%（2026-10-28，见 [tech.md §5.5](tech.md#55-瓦片缓存2026-10-27)）
- `/demo` 打开要十几秒是快照 JSON 太大，现阶段接受，以后单独做 JSON 体积优化（用户确认，2026-10-28，见 [product.md §7](product.md#7-总览-demo-页-demo2026-10-27用户追加)）
- 中途不问用户，技术选择自己定，定了写进文档（用户拍板）

## 文件

| 文件                               | 内容                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [product.md](product.md)           | §1 为什么换引擎；§2 用户看到什么（页面不变，画面换成 Skia）；§3 还原度目标；§4 性能目标和 4 项操作的定义；§5 范围与非目标；§6 成功标准；§7 总览 Demo 页 `/demo`（看到什么、非目标、加载慢可以接受、成功标准）                                                                                                                                                                       |
| [tech.md](tech.md)                 | §1 选型；§2 信号；§3 store、类型、历史、分数索引、几何；§4 `ShapeUtil` 接口；§5 渲染：资源、字体、SVG、裁剪和蒙版、瓦片缓存、选框层、导出区域像素、拖动时的抬起和滑动；§6 工具状态机、事件、吸附；§7 Figma 图形的 Skia 画法：盒子、文字、矢量、和 tldraw 版的差别、文字排版缓存；§8 和现有代码的关系；§9 风险；§10 总览 Demo 页：文件、数据量、排版、加载、标签层、按节点 id 找图层 |
| [plan.md](plan.md)                 | 2026-10-27 开始的一次施工，写成勾选清单：12 个阶段（预研、引擎核心、渲染基础、Figma 画法、渲染器和 React 组件、接 /canvas、调还原度、移植编辑代码、其他页面、性能基准、删 tldraw、文档收尾），每完成一项打勾；2026-10-27～10-28 的总览 Demo 页清单和 9 条修复记录（现象 → 原因 → 改动 → 检查）                                                                                      |
| [verification.md](verification.md) | 自动测试（沿用 figma/ 下的测试，加引擎自己的测试）、还原度对比和性能基准两条端到端检查、手动验收清单、2026-10-27 的实际结果（CanvasKit 实验、字体指标、还原度分数、各用例各操作的帧率、交互脚本）；2026-10-28 `/demo` 的加载时间、内存、全量还原度和整面墙 / 两份墙的帧率                                                                                                           |

## 相关模块

- [Figma 还原到 tldraw](../figma-to-tldraw/README.md)：被替换的旧画布。快照格式、`to-shapes.ts` 的转换、对比脚本、编辑功能的设计都在那里，这个模块沿用它们；旧的 CSS 画法（tech.md §6）是新画法对齐的起点。
