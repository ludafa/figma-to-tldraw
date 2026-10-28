# 自研 Skia 画面引擎：施工计划

> 相关：[模块说明](README.md) · [产品设计](product.md) · [技术实现](tech.md) · [验证方案](verification.md)

## 2026-10-27（`main` 工作区，未提交）

起因：用户要求"参考 `/Users/oliver/code/webgl-figma-tldraw`，把现在基于 tldraw 的画面引擎替换成自研的、基于 Skia / WebGL 的画面引擎"，每个用例还原度 99%（差异 < 1%），4 项核心操作 ≥ 60fps，API 和 tldraw 一致，中途不问问题（用户拍板）。施工中途用户要求先把这份文档整理出来、计划写成勾选清单，每完成一项打勾（用户追加）。

每一项做完就在这里打勾（`- [x]`），后面括号写完成日期和要记的事。

### 阶段 0：预研

- [x] 读参考项目 `webgl-figma-tldraw` 的 `engine/canvaskit.ts`、`camera.ts`、`scene.ts`、`renderer.ts` 和结论（3 万个节点缩到全图一帧 23～27ms → 要瓦片缓存）（2026-10-27）
- [x] 统计全部用例用到的 Figma 特性和 SVG 元素（tech.md §5.3）（2026-10-27）
- [x] Node 里跑 CanvasKit 实验：woff2 直接加载、字体按别名回退、`LineMetrics` 行宽、U+2028、字间距（verification.md §4）（2026-10-27）
- [x] 装依赖：`canvaskit-wasm@0.41.1`、`rbush@4.0.1`、`@types/rbush@4.0.0`（2026-10-27；rbush 最后没用到就在阶段 10 删掉）

### 阶段 1：引擎核心（`apps/client/src/engine/`）

- [x] 信号 `state.ts`（2026-10-27）
- [x] 分数索引 `indices.ts`、几何 `geometry.ts`、类型 `types.ts`（2026-10-27）
- [x] store `store.ts`（副作用、`preserve`、父子索引）（2026-10-27）
- [x] 撤销历史 `history.ts`（2026-10-27）
- [x] `shape-util.ts`（2026-10-27；同日把裁剪接口改成 `getClip` / `getSubtreeClip`，绘制上下文加 `keep()`）
- [x] `editor.ts`（图形增删改、层级、变换和包围盒、命中测试、选择、相机、事件分发）（2026-10-27）
- [x] 工具状态机 `tools/state-node.ts`、选择工具 `tools/select.ts`、抓手 `tools/hand.ts`、吸附 `snaps.ts`（2026-10-27）
- [x] `tsc` 通过（2026-10-27；起初用的 `tsc -p .` 其实什么都没查——根 tsconfig 的 `files` 是空的，要用 `tsc -p tsconfig.app.json` 或 `pnpm typecheck`）
- [x] 引擎自己的单测（信号、store、历史、索引、SVG 解析）（2026-10-27：4 个文件 24 条，见 verification.md §1）

### 阶段 2：渲染基础（`engine/render/`）

- [x] CanvasKit 加载 `canvaskit.ts`（2026-10-27）
- [x] 字体 `fonts.ts`（读 `@font-face`、按 unicode-range 懒加载、CSS 字重匹配）（2026-10-27）
- [x] 资源 `resources.ts`（图片、SVG 图片缓存、`whenIdle`）（2026-10-27）
- [x] SVG 翻成 Skia `svg.ts`（2026-10-27；CanvasKit 0.41 的 `Path` 只读，改用 `PathBuilder`）
- [x] 在浏览器里实际跑通（2026-10-27；修了两个问题：`pushStyle` 要传 `new ck.TextStyle(...)` 补全默认字段；SVG 的 `fill="#F59E0B"` 被当成 `#id` 引用，`url(#id)` 和 `href` 的解析分开）

### 阶段 3：Figma 图形的 Skia 画法（`figma/skia/`）

- [x] Figma 填充 → Skia 画笔 `paints.ts`（纯色、四种渐变、图片四种缩放）（2026-10-27）
- [x] 盒子 `box.ts`（填充、描边、虚线、四边不同粗细、投影、内阴影、背景模糊）（2026-10-27）
- [x] `paint-math.ts`（从 `paint.tsx` 挪出 `gradientMatrix`、`fitDashes`、`ellipsePerimeter`）（2026-10-27）
- [x] 字体指标 `scripts/font-metrics.ts` → `figma/font-metrics.json`（17 个字体族）（2026-10-27）
- [x] 文字排版 `text.ts`（断行、Figma 基线、字间距修正、下划线删除线、截断、渐变文字）（2026-10-27）
- [x] 矢量画法（SVG 图片拉伸、`flipX`）（2026-10-27，`figma/shapes/figma-vector.ts`）
- [x] 四个 `ShapeUtil`（frame、rect、text、vector）改成 `paint()`，`getClip`（`clipsContent`）、`getSubtreeClip`（蒙版）、`getLayerStyle`（混合模式、图层模糊）、`getRenderBounds`（2026-10-27；旧的 `base.tsx`、`box.tsx` 和三个 DOM 图形文件删掉）

### 阶段 4：渲染器和 React 组件

- [x] 场景渲染 `render/renderer.ts`（遍历、图形图片缓存、裁剪、图层、按视野裁掉）（2026-10-27）
- [x] 选框层 `render/overlay.ts`（选框、控制点、悬停、框选、对齐线）和控制点命中测试（2026-10-27；快捷键脚本发现框选矩形整块变黑——CanvasKit 不认 `rgb(r g b / a%)`，改成先用自己的解析，tech.md §5.6）
- [x] 瓦片缓存 `render/tiles.ts`（平移贴图、缩放兜底、脏矩形重画、每帧时间预算）（2026-10-27，`/canvas` 默认就是瓦片模式，175 个用例截图和交互脚本的缩放平移都走它）
- [x] `SkiaCanvas` 组件（WebGL 表面、尺寸跟随、按需重画、截图模式直接画）（2026-10-27；`render/controller.ts` 管 GL 上下文和逐帧绘制）
- [x] 输入：指针事件、滚轮和触控板缩放平移、空格 / 中键平移（2026-10-27；交互脚本：Ctrl+滚轮以鼠标为中心缩放、滚轮平移、按住空格拖动平移 100×50px 对得上；双击改成和 tldraw 一样分按下、松开两段发，tech.md §6.5）
- [x] 快捷键（撤销重做、全选、复制粘贴、复制一份、缩放、工具键、自定义动作）（2026-10-27；快捷键脚本逐个按过：⌘A、⌘D、⌘Z、⌘⇧Z、Backspace、⌘C / ⌘V、⌘= / ⌘-、⇧0、⇧1、V / H / D / A）
- [x] `useEditor`、`useValue` 等 hooks，`engine/index.ts` 统一导出（2026-10-27；另加 `react/ui.tsx` 工具栏和样式面板、`react/rich-text.tsx`、`serialize.ts`）
- [x] 编辑时的 DOM 浮层（`editingComponent`）（2026-10-27；编辑时画布上不画这个图形，只显示 DOM 编辑框，tech.md §6.7）

### 阶段 5：/canvas 接上新引擎，跑通对比

- [x] `figma/shapes/*`、`figma/editor.ts` 改用本引擎（2026-10-27；`figma/`、`pages/`、`showcase/`、`importer/` 的 `from 'tldraw'` 全部换成 `engine`）
- [x] `figma/load.ts` 等资源改成 `resources.whenIdle()`（2026-10-27；`waitForAssets` 只留缺字体告警，之后再等 `getCanvasController(editor).whenIdle()`：一帧画完且没有图形在等图片、字体）
- [x] `pages/canvas.tsx` 的 `<Tldraw>` 换成 `<SkiaCanvas>`，截图模式去掉 `TLDRAW_LAYER_OFFSET`（2026-10-27）
- [x] `?shot=1` 能出图，`compare` 能跑完 175 个用例（2026-10-27）

### 阶段 6：调还原度到每个用例 < 1%

- [x] 全量跑第一遍，记下分数（2026-10-27：平均差异 7.00%，144/175 个 < 1%，报告 `reports/fidelity/20261027-213537`；最差的是 untitled-ui 的 dashboards 和 `blend/modes`，90% 以上）
- [x] 按差异从大到小逐类修（每修一类全量重跑，确认别的用例没变差）（2026-10-27）
  - [x] 混合模式整块变黑：GL 上下文没带 alpha，Skia 读回目标像素时 `glCopyTexSubImage2D` 报格式不符；改成 `alpha: 1`（2026-10-27，tech.md §5）
  - [x] 混合模式修完重跑失败的 31 个：18 个降到 1% 以下（untitled-ui 全部、`blend/modes` 0.16%、`effect/background-blur` 0.04%），剩下 13 个都是 Lato 的稿子（1.09%～2.65%）（2026-10-27，`reports/fidelity/20261027-214327`）
  - [x] Lato 的字整体偏高：typo 行距不为 0 的字体改用 hhea 上下沿（tech.md §7.2）。33 个 Lato 用例全部变好，只剩 designs-48 1.40%（2026-10-27，`reports/fidelity/20261027-214727`）
  - [x] designs-48 的混合字号：行和行按"下一行的整个行高"往下排；覆盖表里"自动"行高按基础比例算；字间距按百分比继承（tech.md §7.2）
  - [x] 全量重跑：**175 / 175 个 < 1%，平均 0.17%**，最差 `dark-page-desktop` 0.94%（2026-10-27，`reports/fidelity/20261027-215446`）
  - [x] `dark-page-desktop` 从 0.71% 变成 0.94%：混合模式修好以后背景模糊真的画出来了，但 Skia 会把框外的颜色模糊进来（导航栏顶边透出上面的粉色）；改成两层 `saveLayer`（tech.md §7.1）。38 个带背景模糊的用例全部持平或变好：`effect/background-blur` 0.04% → 0.00%，`dark-page-desktop` 0.94% → 0.71%（2026-10-27，`reports/fidelity/20261027-220309`）
- [x] 175 个用例全部 < 1%（2026-10-27，`reports/fidelity/20261027-215446` 加上背景模糊修完后的 38 个用例重跑；收尾时再全量跑一次，见阶段 11）

### 阶段 7：移植编辑代码和测试

- [x] 画笔、箭头工具和图形（`engine/shapes/`，tldraw 版用户定的保留项）（2026-10-27；`defaultShapeUtils` / `defaultTools` 由 `<SkiaCanvas>` 自动合并，tech.md §6.8；交互脚本：D 画出 21 个点的笔迹，A 拖出箭头后回到选择工具，⌘Z 撤销掉箭头）
- [x] `figma/editing/*` 换 import（engine、host、selection、snapping、tools、layers、panel、instances、create、rich-text、auto-layout）（2026-10-27，typecheck 通过）
- [x] `drag-style.ts` 的 CSS 过渡动画改成引擎里的动画（2026-10-27；`SceneRenderer` 加 `setLifted` / `setSlideMs` / `tick`，tech.md §5.8；`renderer.test.ts` 测 `easeInOut`）
- [x] `text-measure.tsx` 改用 Skia 排版量文字（2026-10-27）
- [x] 文字编辑框（替换 TipTap 的 `RichTextArea`）（2026-10-27；`engine/react/rich-text.tsx` 的 `RichTextArea` 直接用 `@tiptap/core`，和 tldraw 一样；`figma/editing/text-editor.tsx` 照 Figma 排版铺在图形上。交互脚本：双击进入编辑、打字改到 `characters`、Esc 退出）
- [x] `figma/**/*.test.ts` 跑在本引擎上，全部通过（2026-10-27：82 条；修了 store 的副作用时机——按 id 合并、`editor.run` 不再包成一次操作，见 tech.md §3）

### 阶段 8：其他页面

- [x] `/showcase`（`showcase/case-canvas`、`node-tree-demo`）（2026-10-27，浏览器打开用例详情，画布画得出来，没有报错）
- [x] `/how-it-works`（2026-10-27，节点树演示的画布正常）
- [x] `/report`（2026-10-27，页面没有画布，数字从最新报告读）
- [x] `/import`（`importer/shot-stage`、`capture` 改成 Skia 导出 PNG）（2026-10-27；`exportArea` 分条导出，tech.md §5.7。导入 5 个用例的 zip：0% / 0% / 0.25% / 0% / 0.16%，和对比脚本一致；背景模糊以前截不出来，现在 0%。面板里的说明文字同步改了）

### 阶段 9：性能基准

- [x] `scripts/bench.ts`（verification.md §2 的测法）（2026-10-27；加了长帧数，没有可拖图层的用例算跳过）
- [x] 平移 ≥ 60fps（2026-10-27，5 个用例 239～240fps，长帧 0）
- [x] 缩放 ≥ 60fps（2026-10-27，221～240fps；换缩放级别的第一帧偶尔超过 33ms，verification.md §4）
- [x] 自由布局里拖动节点 ≥ 60fps（2026-10-27，234～238fps）
- [x] 自动布局容器里拖动排序 ≥ 60fps（2026-10-27，224～237fps，加了滑动动画后重跑仍在 230fps 以上）

### 阶段 10：删掉 tldraw

- [x] 删掉 `tldraw`、`modern-screenshot`、没人用的 `@tiptap/core`、`rbush`（2026-10-27；`pnpm remove` 掉 `tldraw`、`modern-screenshot`、`rbush`、`@types/rbush`，锁文件少了 117 个包。偏差：`@tiptap/core` 留下——文字编辑框 `engine/react/rich-text.tsx` 直接用它，和 tldraw 一样，见阶段 7）
- [x] 删 `figma/clip.ts`，`paint.tsx`、`effects.ts` 里只给 CSS 用的部分（2026-10-27；三个文件整个删掉——Skia 画法要的数学早已挪进 `paint-math.ts`；`isFigmaShape` 挪到 `shape-types.ts`；`paint.test.ts` 里的渐变矩阵断言改写成 `paint-math.test.ts`。另删 `importer/capture.ts` 和它的测试（DOM 截图），以及 `figma.css` 里 `.figma-vector > svg`、`.tl-text-input`、15 条 `data-figma-blend` 混合模式、`.figma-shot .tl-background`）
- [x] `pnpm lint`、`pnpm typecheck`、`pnpm test` 通过（2026-10-27：21 个测试文件 122 条通过；`pnpm --filter @figma-to-tldraw/client build` 也通过；删完重跑交互脚本和拖动排序脚本，结果不变）

### 阶段 11：文档收尾

- [x] 本模块各文件改成实际结果（verification.md 记分数和帧率）（2026-10-27；收尾全量重跑 `reports/fidelity/20261027-222657`：175 / 175 个 < 1%，平均 0.17%，48 个逐像素一致，最差 `designs-30` 0.93%（和之前一样）；和 `20261027-215446` 比没有用例变差，7 个变好（背景模糊那次修复）。README 状态改成已上线）
- [x] [Figma 还原到 tldraw](../figma-to-tldraw/README.md) 相关章节加修订说明，指到这里（2026-10-27：README 概要和关键决定；tech.md §2、§3、§4.1、§5、§6、§7、§13.3、§13.6、§19.2 开头各加一行修订说明）
- [x] `CLAUDE.md` 里提到 tldraw 的地方同步改（2026-10-27：查过，`CLAUDE.md` 里的 tldraw 只出现在项目名 `figma-to-tldraw` 里，没有讲 tldraw 库的地方，不用改）

### 阶段 11b：收尾时自查发现（计划外）

- [x] 抬起的图形有一层祖先被隐藏时，`drawLifted` 提前返回没把 `animDepth` 恢复，之后整页的 `pageBounds` 都不再缓存，图形再挪动时旧位置不会被标成脏区（2026-10-27；提前返回前恢复 `animDepth`；重跑单测和拖动排序脚本通过）

## 2026-10-27～10-28（总览 Demo 页，用户追加）

起因：用户要一个"整体能看到"的 Demo 页面放在 client 里，多放用例，画面里至少 2 万个节点（用户追加）。设计见 [product.md §7](product.md#7-总览-demo-页-demo2026-10-27用户追加)、[tech.md §10](tech.md#10-总览-demo-页-demo2026-10-27用户追加)。

- [x] 统计数据量：175 个用例转出 22100 个图形，原文件 937MB（tech.md §10.2）
- [x] `demo/layout.ts` 的 `layoutWall` 和单测（`layout.test.ts`，4 条）
- [x] `demo/load.ts`：按顺序并发加载、平移、放进编辑器
- [x] `routes/demo.tsx`、`pages/demo.tsx`：画布、左上角面板（进度、图形数、帧率、看全部、类别列表）
- [x] 标签层：类别名、用例名，大小不随缩放，太小自动隐藏，点了跳过去
- [x] 浏览器里打开：175 个用例都加载出来，图形数 22100，加载过程中能操作
- [x] 修崩溃：加载到一半 wasm 堆涨满 2GB（见下面"修复记录" 1、2）
- [x] 修 `__figmaReady` 一直不变 true（修复记录 3）
- [x] 图片放到 wasm 堆外、按缩放挑尺寸（修复记录 4）
- [x] 瓦片分片补画、脏块也按预算（修复记录 5）
- [x] 拖动第一帧卡顿：按节点 id 找图层改成索引（修复记录 6）
- [x] `scripts/bench.ts` 支持 `/demo` 和 `/demo@<用例>`，按显示器刷新率定目标；4 项操作在整面墙和放大到单个用例上都达标（verification.md §4）
- [x] 标签互相压住、面板挡住墙（修复记录 7）
- [x] 全量对比确认图片分级、共用字体集合没有让还原度变差：175 / 175 小于 1%，平均 0.155%（原来 0.168%）；中途 3 个用例超时，修了（修复记录 8）
- [x] `?copies=2` 压到 44200 个图形再测一次（verification.md §4）
- [x] 放大到一块时类别名跑出屏幕、点画布上的标签后画布被滚走（修复记录 9）
- [x] 展示页加 `/demo` 入口（"全部用例一张画布 →"）。调试页 `/canvas` 没有通用的导航栏，没加
- [x] `pnpm lint`、`pnpm typecheck`、`pnpm test`（23 个文件、133 条）、`pnpm --filter @figma-to-tldraw/client build`、`pnpm docs:check-refs` 通过；verification.md §4 记了结果。收尾跑 typecheck 时修了两处 TypeScript 6 的报错：`renderer.ts` 的 `fits` 写成类型谓词后，`if (fits(e)) return e` 的另一支把 `e` 收窄成 `undefined`；`resources.ts` 里 `?? await …` 推不出尺寸类型，拆成 `decodedSize()`

用户在施工中确认：打开要十几秒是快照 JSON 太大，现阶段可以接受，以后单独安排一章优化 JSON 体积；这次重点看还原度、基本操作和性能（用户确认，2026-10-28）。

### 修复记录（2026-10-28）

1. **wasm 堆涨满，页面崩溃。**
   - 现象：加载到一百多个用例时控制台报 "memory access out of bounds"，接着 `Aborted()`，画面停住。
   - 原因（第一层）：所有图片在 wasm 里解码（`MakeImageFromEncoded`），全部用例 1299 张图解码后约 4.1GB，CanvasKit 的堆最多 2GB。
   - 改动：图片改由浏览器解码（`createImageBitmap` + `MakeLazyImageFromTextureSource`），按内容去重（tech.md §5.1）。
   - 检查：堆不再随图片涨，但还是会涨满，见第 2 条。
2. **去掉图片后堆还是涨满。**
   - 现象：不加载任何图片，堆照样从 100 多 MB 涨到 2GB；字体加载完那一帧卡 20 秒。
   - 原因：`ParagraphBuilder.MakeFromFontProvider` 每建一个段落都新建一个字体集合，加上每段都带 `wght` 变量轴，Skia 每建一个段落就把字体克隆一份（Lato 每次约 0.8MB），被字形缓存挂着；文字图形还把每一段排版结果都留着。
   - 改动：共用一个 `FontCollection`（tech.md §5.2）；只给可变字体传变量轴（§7.2）；文字排版只留最近 64 个，范围单独缓存（§7.5）。
   - 检查：整面墙加载完堆 161～193MB；单段文字排版约 8ms → 0.3ms（实测）。
3. **`__figmaReady` 永远是 false。**
   - 现象：`/demo` 加载完两分钟，`whenIdle()` 还在等"不完整的录制"。
   - 原因：66 个头像被父级 `clipsContent` 裁掉，再也不会画到，它们的录制一直"不完整"。
   - 改动：资源版本变了就扔掉不完整的录制、标脏，看不见的就不再算（tech.md §5 第 4 步）。
   - 检查：约 13 秒后 `__figmaReady` 变 true（实测）。
4. **整面墙缩放只有 20fps。**
   - 现象：缩放时每换一层瓦片都卡。
   - 原因：几百张原图每层都要重新上传成纹理，2 秒里 `texImage2D` 占 703ms。
   - 改动：查了 Figma（512 以上的图存高低两档）和 tldraw（`TLAssetStore.resolve` 按屏幕缩放取图）的做法，按缩放解码 1/2^k 的图（tech.md §5.1），录制记缩放档位（§5 第 4 步）。
   - 检查：`texImage2D` 降到 20ms，缩放 46fps。
5. **缩放、加载时还有长帧。**
   - 现象：整面墙缩小时一块瓦片画 25～40ms；图片的一档到了以后脏块一口气重画，帧间隔 100～200ms。
   - 原因：瓦片整块画、每帧至少一块；脏块不受预算限制；预算没算 GPU `flush` 的时间。
   - 改动：瓦片分成 128 × 128 的片，画完一片 `flush` 一次；脏矩形按格子合并，和新瓦片共用预算；缩放中预算减到 40%、不强制补；总览也分片（tech.md §5.5）。
   - 检查：整面墙 4 项操作都到 60fps（verification.md §4）。
6. **拖动第一帧卡 50ms。**
   - 现象：在 `/demo` 上按下拖动，第一帧 50ms。
   - 原因：属性面板找实例的主组件时 `shapesByNodeId` 扫全部 22100 个图形；第一次建 Map 还发生在响应式计算里，把全部图形记成了依赖。
   - 改动：`shapeByNodeId` 先按同一用例的 id 前缀直接取，不行再查增量维护的索引（tech.md §10.6）。
   - 检查：自由拖动、自动布局拖动都 ≥ 59.5fps。
7. **标签压在一起、面板挡住墙。**
   - 现象：截图里缩小时用例名叠在一起，"看全部"后墙的左上角在面板下面。
   - 原因：标签用 `opacity` 隐藏，透明的标签还占位置；长名字伸到隔壁板上；"看全部"不知道有面板。
   - 改动：按缩放阈值切 `display`、用 `--label-w` 截断加省略号、`zoomTo` 给面板和工具栏留边（tech.md §10.5）。
   - 检查：截图确认（`scratchpad/shots/demo-wall.png`，会话临时目录）。
8. **全量对比里 3 个用例超时。**
   - 现象：`settings-pages-desktop-2`、`settings-pages-desktop-4`、`design-product-detail-2` 等 `__figmaReady` 等了 30 秒；资源版本每帧加一，两个图片矩形一直在重录。
   - 原因：`trimLevels` 用 `slice(0, 已加载档数 − 3)` 选要丢的档，档数不到 3 时减出来是负数，`slice` 把负数当成"从后往前数"，还是丢了一档；刚解码好的那一档 `used` 还是请求时的旧值，正好被丢掉。于是同一档反复请求、解码、丢掉。
   - 改动：选档挪成纯函数 `levelsToDrop`（负数按 0 算）加单测；解码好时把 `used` 更新成最新（tech.md §5.1 第 4 条）。
   - 检查：3 个用例 0.05% / 0.04% / 0.35%，2 秒内 ready；`image-size.test.ts` 加 2 条。
9. **放大到一块时看不到类别名；点画布上的标签后画面错位。**
   - 现象：点面板里的"填充"，只看得到用例名，类别名在屏幕外；Playwright 点画布上的类别名后，画布和工具栏一起上移了约 450px。
   - 原因：类别名离块的距离是页面单位（标题带的 1/5），放大后变成几百像素；画布容器是 `overflow: hidden`，浏览器为了让焦点元素露出来会滚动它。
   - 改动：类别名的距离改成 `min(24px, 页面距离 × 缩放)`；画布容器改成 `overflow: clip`（tech.md §10.5）。
   - 检查：截图（整面墙、"填充"、"Golio 落地页"）类别名和用例名都在、不重叠；对 `.skia-canvas` 里的标签 `focus()` + `scrollIntoView()` 后 `scrollTop` 仍是 0；`fill/*`、`text/*`、`effect/*` 和 `designs-30` 共 28 个用例对比结果和改之前完全一样。
10. **半透明图形的背景模糊画成满强度。**
    - 现象：Free Banking 的 All Cards 8.25%（换引擎前 0.086%），卡片上一个 20% 不透明的椭圆下面，字和白缝被模糊成一条条亮带（2026-10-28，`/import` 回归检查时发现）。
    - 原因：Figma 的 SVG 只在图形上写 `opacity`，背景模糊的 `<foreignObject>` 上没有；我们照字面画成满强度，Figma 自己画时背景模糊也乘图层不透明度。
    - 改动：`render/svg.ts` 的 `backdropOpacity` 取所属图形的不透明度，背景模糊的 `saveLayer` 带上它（tech.md §5.9）。`svg.test.ts` 加 1 条。
    - 检查：All Cards 0.44%、Home 0.47% → 0.30%，其余 3 页不变；175 个用例里的 7 个 SVG 背景模糊都没有 `opacity`，结果不变。
