# 自研 Skia 画面引擎：技术实现

> 相关：[模块说明](README.md) · [产品设计](product.md) · [施工计划](plan.md) · [验证方案](verification.md)

代码分两块：`apps/client/src/engine/` 是和 Figma 无关的通用引擎（数据、编辑器、工具、渲染、React 组件），`apps/client/src/figma/skia/` 是 Figma 图形怎么用 Skia 画。

## 1. 选型（2026-10-27）

| 方案                                       | 结论                                                                                                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CanvasKit（Skia 的 WebAssembly 版）+ WebGL | ✅ 选它。Figma 自己的渲染器也是 Skia 一类的 2D 引擎，渐变、模糊、混合模式、路径布尔运算、段落排版（ICU + HarfBuzz）都现成；参考项目 `webgl-figma-tldraw` 已经验证过加载和 WebGL 表面（用户指定参考）。wasm 约 7MB |
| 留着 tldraw，只优化 CSS                    | ❌ 还原度和性能的上限都卡在浏览器（[product.md §1](product.md#1-要解决的问题2026-10-27)）                                                                                                                         |
| PixiJS                                     | ❌ 面向游戏精灵，没有路径布尔、背景模糊、段落排版，矢量要先栅格化                                                                                                                                                 |
| 手写 WebGL                                 | ❌ 抗锯齿路径、文字、滤镜都得从头写，工作量不可控                                                                                                                                                                 |
| Canvas 2D                                  | ❌ 没有背景模糊、没有自定义字体指标，文字排版还是浏览器那一套                                                                                                                                                     |

**API 照搬 tldraw**（用户拍板）：类名、方法名、参数和返回值和 tldraw 3.15 一样，`figma/editing/` 和测试只把 `from 'tldraw'` 换成 `from '../../engine'`。只实现现有代码用到的那部分。

CanvasKit 版本锁 0.41.1。这个版本的 `Path` 是只读的，要用 `PathBuilder` 拼路径（`new ck.PathBuilder()` → `moveTo` / `addRRect` … → `detachAndDelete()`），合并用 `path.makeCombined(other, PathOp.Union)`。

## 2. 信号（`engine/state.ts`）（2026-10-27）

和 tldraw 的 `@tldraw/state` 用法一样：`atom(name, value)`、`computed(name, fn)`、`react(name, fn)`（返回停止函数）、`transact(fn)`、`unsafe__withoutCapture(fn)`、`isSignal`。

实现是"按纪元比较"：全局一个纪元计数，`atom.set` 时加一；`computed` 记下自己上次算的时候每个依赖的纪元，被读时先看依赖有没有变，没变直接返回缓存。只有被 `react` 或别的活跃 `computed` 订阅着的 `computed` 才挂在父节点上（attach），没人用的不会因为依赖变化被通知。`transact` 里的多次 `set` 合并成一次通知。类里的字段都显式声明，不用构造函数参数属性（`erasableSyntaxOnly`）。

## 3. 数据层（`engine/store.ts`）（2026-10-27）

`Store` 存所有记录（页面、图形），每条记录一个 atom，按类型再有一个 id 集合 atom，所以"读某个图形"只订阅那一个图形。另外维护父子索引：每个父节点一个版本 atom，`sortedChildIds(parentId)` 按 `index` 排好序并缓存，版本变了才重排。

- 写入：`put`、`remove`、`update`、`applyDiff`。`preserve()` 在写入前比较新旧记录：`props`、`meta` 浅比较相等就沿用旧对象，整条记录没变就跳过。渲染器靠"`props` 还是不是同一个对象"决定要不要重录图形（§5），所以这一步很重要。
- 副作用：`sideEffects.register{Before,After}{Create,Change,Delete}Handler(type, fn)`、`registerOperationCompleteHandler(fn)`，都返回撤销注册的函数，和 tldraw 一样。after 类的回调排队，等最外层操作结束再统一跑；`operationComplete` 循环到没有新改动为止（最多 20 轮）。**排队按记录 id 合并**（和 tldraw 一样，每个 id 只记最早的 `before` 和最新的 `after`）：同一次操作里先删再建同一个 id，回调收到的是一次 `afterChange`；先建再删什么也不发。
- 一次"操作"是一次 `put` / `remove` / `applyDiff`（或显式的 `store.atomic`）。`editor.run(fn)` 和 tldraw 一样只是信号层的 `transact` 加历史模式，**不把整个 `fn` 合成一次操作**：`fn` 里每次写入结束都会立刻跑 after 回调和 `operationComplete`。
  > 2026-10-27 修订：原来 after 回调按发生顺序逐条排队，`editor.run` 也包成一次 `store.atomic`，回调要等整个 `run` 结束才跑。理由：组件引擎（`figma/editing/engine.ts`）按 tldraw 的时机写——`resetInstance` 先删实例的子图层、同步一次副本，再按同样的 id 重建、再同步一次；全部攒到最后才发，副本的子图层被删掉却没有重建（`instances.test.ts` 的 "keep the copies when a nested instance in the main is reset"）。改成和 tldraw 一样以后 `figma/**/*.test.ts` 82 条全部通过。
- 监听：`listen(fn)` 每次操作结束给一个合并后的 diff（`added` / `updated` / `removed`）；`onApply(fn)` 每次实际写入都给（撤销历史和包围盒缓存用）。
- 查询：`query.records('shape').get()`、`unsafeGetWithoutCapture(id)`。`createTLStore()` 返回一个空 store。

### 3.1 类型（`engine/types.ts`）

`TLShapeId`（`shape:` 前缀）、`TLPageId`（`page:` 前缀）、`TLParentId`、`TLBaseShape<Type, Props>`、`TLShape`、`TLPage`、`TLShapePartial`、`TLCamera`、`createShapeId`、`createPageId`、`isShapeId`、`isPageId`，形状和 tldraw 一致。`TLShape` 的 `props` 是 `any`（加了 `oxlint-disable` 和原因），和 tldraw 的宽松程度一样，否则 `figma/` 里大量 `as FigmaShape` 要改。

### 3.2 撤销历史（`engine/history.ts`）

`HistoryManager` 记录每次写入的 diff，`mark(id)` 打标记，`undo` / `redo` 以标记为单位，`bailToMark`（取消拖动时整段丢掉）、`squashToMark`、`clear`、`canUndo` / `canRedo`。有三种模式：`record`、`record-preserveRedoStack`、`ignore`。撤销和重做也是用 `store.applyDiff` 写回去（在 `ignore` 模式下），所以副作用照常运行，比如自动布局会重新排。

### 3.3 分数索引（`engine/indices.ts`）

图形的叠放顺序用 base62 的分数索引字符串（`a1`、`a2`、`a1V` …），两个索引之间总能插一个新的：`getIndexBetween`、`getIndicesBetween`、`getIndexAbove` / `getIndexBelow`、`getIndices(n, start = 'a1')`、`sortByIndex`。和 tldraw 用的 `fractional-indexing` 编码兼容，快照里已有的索引直接能用。

### 3.4 几何（`engine/geometry.ts`）

`Vec`、`Box`（`minX` / `midX` / `maxX`、`collides`、`contains`、`Box.Common` …）、`Mat`（字段 `a b c d e f`，和 CSS / Canvas 的矩阵顺序一样；`Mat.Compose`、`Inverse`、`applyToPoint`、`applyToBounds`、`Decompose`；`toSkia()` 转成 CanvasKit 的 3×3 数组）、`Geometry2d`、`Rectangle2d`、`Ellipse2d`。

### 3.5 导出 `.tldr`（`engine/serialize.ts`）（2026-10-27）

`/import` 页的"下载 .tldr"（tldraw 版 tech.md §19.5）原来用 tldraw 的 `serializeTldrawJson`。现在引擎自己写同名函数：文件格式版本 1，`schema` 里放 tldraw 3.15.6 自带记录的迁移序号（从 `@tldraw/tlschema` 的 `createTLSchema().serialize()` 抄下来），再给每种自定义图形补一个 `com.tldraw.shape.<type>: 0`；记录是一条 `document:document` 加上所有页面和图形。这样导出的文件还能用装了 Figma 图形类的 tldraw 打开（未验证）。

## 4. `ShapeUtil`（`engine/shape-util.ts`）（2026-10-27）

和 tldraw 的 `ShapeUtil` 一样每种图形一个类，`static type`、`getDefaultProps`、`getGeometry`、各种 `can*` / `hide*` 开关、`onResize` / `onTranslate*` / `onRotate*` / `onDoubleClick` / `onEditEnd` 等回调，以及 `resizeBox`。

不一样的地方是"怎么画"：tldraw 的 `component()` 返回 React 元素，这里换成

- `paint(shape, { ck, canvas, resources, keep })`：在图形自己的坐标系里画自己的内容，子图形由引擎画；画的时候新建的 Skia 对象（`Paint`、`Shader`、`ImageFilter`……）交给 `keep()`，录完图片后统一删掉；
- `paintAfterChildren?`：画在子图形上面、仍在自己的裁剪里；
- `clipsChildren()` / `getClip?(shape, ck)`：子图形的裁剪（Figma 的 `clipsContent`），返回 `{ kind: 'rect' | 'rrect' | 'path' }`；命中测试只看 `clipsChildren()`，不用真的建路径；
- `getSubtreeClip?(shape, ck)`：连自己带子树一起裁（Figma 的蒙版，§5.4）；返回的 `Path` 归图形类所有，引擎不删；
- `getLayerStyle?`：混合模式、要不要单独合成一层；
- `getRenderBounds`：画出来的范围（含阴影、外描边、模糊），用来裁剪看不见的图形和算脏矩形；
- `getPaintKey?`：除了 `props` 以外还会影响画面的东西；
- `editingComponent?`：编辑时盖在画布上的 DOM（文字编辑框）。

透明度用图形记录上的 `opacity`，由引擎在整棵子树外面套一层 `saveLayer`。

> 2026-10-27 修订：原来裁剪只有一个 `getClipPath`，现在拆成 `getClip`（只裁子图形）和 `getSubtreeClip`（连自己一起裁），绘制上下文加 `keep()`。理由：蒙版要裁被蒙的图形自己，`clipsContent` 不裁 frame 自己；返回圆角矩形比返回路径快。

## 5. 渲染（2026-10-27）

`engine/render/canvaskit.ts` 加载 CanvasKit：`CanvasKitInit({ locateFile: () => wasmUrl })`，wasm 地址用 Vite 的 `?url` 导入；`getCanvasKit()` 同步拿已加载的实例；Node 脚本可以自己加载后用 `setCanvasKit` 塞进来。

一帧怎么画（`render/controller.ts` 的 `CanvasController.frame()`，场景部分在 `render/renderer.ts` 的 `SceneRenderer`）：

1. 资源版本变了（图片、字体加载完）：把录的时候"不完整"的图形的范围标脏；再从 store 的 diff 收集脏矩形（改动图形的旧范围和新范围）。
2. 从当前页的根开始按叠放顺序走图形树，累乘局部矩阵；子树的绘制范围（`getRenderBounds` 并上子图形，`clipsContent` 时裁到 frame）和视野不相交就整棵跳过。子树范围按图形缓存，store 改了某个图形就清掉它和所有祖先的缓存。
3. 每个图形 `save` → 乘局部矩阵 → `getSubtreeClip`（蒙版）→ 有透明度、混合模式、图层模糊就 `saveLayer` → 画自己的图片 → 在 `getClip` 里画子图形 → `paintAfterChildren` → `restoreToCount`。
4. 每个图形的 `paint()` 录成一张 `SkPicture`，缓存键是 `props` 对象 + `getPaintKey()`；录的时候有图片或字体没加载完（`resources.track()` 报告），就记成"不完整"。资源版本变了，所有不完整的录制直接扔掉、范围标脏（`markIncompleteDirty`）：还看得见的下次画到时重录，看不见的（比如被父级 `clipsContent` 裁掉的）就不再算"不完整"。不完整的图形 id 单独放一个集合，`hasIncomplete()` 不用每帧扫全部录制。
   > 2026-10-27 → 2026-10-28 修订：原来不完整的录制留在缓存里，等下次画到时重录。被父级裁掉、再也不会画到的图形因此一直"不完整"，`whenIdle()` 永远等不到，`/demo` 的 `__figmaReady` 两分钟都不变成 true（Untitled UI `informational-pages-mobile-2` 里 66 个头像，2026-10-28 实测）。
   - 用了按缩放挑尺寸的图片（§5.1）的录制，还记着录的时候的缩放档位（`floor(log2(设备像素 / 局部单位))`）。档位变了就重录，旧档位的录制留一份备用（`PictureEntry.alt`）：总览图和瓦片用两种倍数轮流画同一个图形时，不会来回重录。（2026-10-28）
5. 交互模式经瓦片缓存（§5.5）上屏；截图模式（`renderMode: 'direct'`）每帧整页直接画。
6. 选框层（§5.6）每帧单独画在最上面，然后 `surface.flush()`。

重画由两件事触发：`store.listen`（任何记录变化），以及一个 `react()` 盯着相机、当前页、选择、悬停、编辑中的图形、实例状态（框选、光标）、视口大小、对齐线、工具状态路径和资源版本。都只是 `requestAnimationFrame` 排一帧，一帧里多次改动合并。

GL 上下文只建一次（`GetWebGLContext` + `MakeWebGLContext`），尺寸变了只重建屏幕表面（`MakeOnScreenGLSurface`），这样瓦片的离屏纹理在改尺寸后还能用。截图模式开 `preserveDrawingBuffer`。上下文必须带 alpha（`alpha: 1`）、不开多重采样（`antialias: 0`）：Skia 画 multiply、screen 这类混合模式时要把已经画好的像素拷进一张 RGBA 纹理（`glCopyTexSubImage2D`），不带 alpha 的屏幕缓冲是 RGB，WebGL 不让从 RGB 拷到 RGBA，混合图层会整块变黑（`blend/modes` 用例，2026-10-27 实测）。每帧都先用不透明的底色清屏，所以带 alpha 不影响画面。`whenIdle()` 等到"画完一帧、没有资源在加载、没有不完整的图片"，`/canvas` 截图模式用它代替原来等 DOM 图片和 `document.fonts` 的做法。

### 5.1 资源（`engine/render/resources.ts`）

`Resources` 管图片、字体和 SVG 图片缓存，`version` atom 在任何资源加载完时加一，渲染器订阅它来重画。

- 图片（2026-10-27，2026-10-28 修订）：`getImage(url, scale?)` 第一次调用时开始 `fetch`。没加载完返回 `undefined`，并把当前录制标成不完整（`track(fn)` 返回 `{ value, complete, scaled }`）。SVG 里内嵌的 `data:` 图片用 `getDataImage` 在 wasm 里同步解码。
  1. 下载完先读文件头拿原图尺寸（`render/image-size.ts`（新）的 `encodedImageSize`，认 PNG、JPEG、WebP、GIF；认不出来就整张解码一次量尺寸），`imageSize(url)` 返回它。再按内容的 SHA-1 去重：不同用例目录里的同一张图（文件名就是 Figma 的图片哈希）只留一份。
  2. 解码交给浏览器：`createImageBitmap(blob, { premultiplyAlpha: 'premultiply', resizeWidth, resizeHeight, resizeQuality: 'high' })`，再用 `ck.MakeLazyImageFromTextureSource` 包成 Skia 图片。像素留在浏览器里，第一次画的时候才上传成 GPU 纹理，**不占 CanvasKit 的 wasm 堆**。没有 `createImageBitmap` 的环境（Node 脚本、单元测试）退回 `MakeImageFromEncoded`。
  3. **按缩放挑尺寸**：`scale` 是一个原图像素在屏幕上占几个设备像素。第 k 档是原图的 1/2^k，k = `floor(log2(1 / scale))`（`imageLevel`），这一档的分辨率不会低于需要的；最长边最少缩到 256px；最长边不超过 512px 的图不缩（Figma 也是 512 × 512 以上才算高清图）。不传 `scale` 就是原图。
  4. 要的档位还没解码好时，先用已经有的最接近的一档（优先更清楚的），同时把录制标成不完整，那一档到了再重录。每张图最多同时留 3 档，多了按最近使用丢掉句柄（`image-size.ts` 的 `levelsToDrop`；刚解码好的一档算最近用过，不然它会被马上丢掉、再请求、再丢掉，`whenIdle()` 永远等不到，2026-10-28 全量对比时 3 个用例因此超时）；还被录制用着的档位由 Skia 的引用计数留着，录制换掉以后才真正释放。
  5. 调用方按这一档自己的 `width()` / `height()` 映射：`figma/skia/paints.ts` 的 `imageShader` 先按原图尺寸算出图片矩阵，取矩阵的缩放（每个原图像素占几个局部单位）乘 `PaintContext.scale` 得到要的 `scale`，拿到图片后再把矩阵的前两列乘上"原图尺寸 / 这一档尺寸"。
  6. `PaintContext.scale` 从哪来：瓦片、总览、截图和 `readArea` 调 `drawPage` 时传 `SceneDrawOptions.scale`（设备像素 / 页面单位），`drawShape` 再乘图形页面矩阵的缩放（行列式开方），最后取到档位上界 `2^(档位 + 1)`。所以同一档里怎么缩放都不用重录，图片最多多出 2 倍分辨率。

  | 方案                                  | 结论                                                                                                                                                                                                                                       |
  | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | wasm 里解码（`MakeImageFromEncoded`） | ❌ 全部用例的图解码后约 4.1GB（1299 张，原文件 447MB），按内容去重后还有 1.43GB（343 张），CanvasKit 的 wasm 堆最多 2GB。`/demo` 加载到一半就 "memory access out of bounds"、`Aborted()`（2026-10-28 实测）                                |
  | 浏览器解码、原尺寸上传纹理            | ❌ 堆不涨了，但每换一层瓦片就要把几百张原图重新上传：`/demo` 整面墙缩放 2 秒里 `texImage2D` 占 703ms（31.6%），20fps                                                                                                                       |
  | 预处理，给每张图生成几档缩略图文件    | 以后再说：能省下载和解码，但要改用例数据，`/import` 页从插件 zip 里读的图也用不上。和快照 JSON 体积一起放进以后单独的体积优化（用户拍板：现阶段加载慢可以接受，JSON 体积以后单独做）                                                       |
  | 把大图切成小块纹理                    | ❌ 用不着：用例里最大的图 4096 × 3921，WebGL 纹理上限 16384                                                                                                                                                                                |
  | GPU 纹理压缩（ETC、ASTC 等）          | ❌ 要带编码器，分级以后显存已经够用                                                                                                                                                                                                        |
  | ✅ 浏览器按需缩小解码（上面的做法）   | `texImage2D` 从 703ms 降到 20ms，整面墙缩放从 20fps 到 46fps（再加 §5.5 的分片补画到 60fps）。思路和 Figma 一样（512 以上的图存高低两档，视野外先用低清的），tldraw 的 `TLAssetStore.resolve` 也按 `steppedScreenScale` 取不同分辨率的地址 |

- `svgPicture(svg)`：同一段 SVG 字符串只解析、录制一次（§5.3），最多缓存 20000 段，超出时删最早的。
- `whenIdle()`：等所有图片和字体加载完，`/canvas` 的 `__figmaReady` 用它。

### 5.2 字体（`engine/render/fonts.ts`）

CanvasKit 不能用浏览器的字体，要自己把字体文件交给它。`FontRegistry`：

- `scanDocument()` 读页面上所有 `@font-face` 规则（包括 `@import` 进来的），记下 family、字重范围、style、unicode-range 和地址（有 woff2 用 woff2）。CanvasKit 自带的 FreeType 能直接读 woff 和 woff2（2026-10-27 实测，不用先转成 ttf）。
- 每个字体文件注册成一个独立的别名（`f0`、`f1` …），因为 `TypefaceFontProvider` 同一个名字下只返回一个字形文件，Noto Sans SC 被 fontsource 切成了 100 多个按 unicode-range 分的文件。
- `aliasesFor(stack, text)`：按 CSS 的字重匹配规则（400～500 先往上找到 500，再往下，再往上；小于 400 先往下；大于 500 先往上）挑出每个候选字体的文件，只取覆盖了 `text` 里字符的那几个，按顺序排成段落样式的 `fontFamilies`。段落排版会逐个字符在这些别名里找第一个有这个字形的（实测中英文混排能正确回退）。没加载的文件这时开始加载，返回 `ready: false`。
- 同时保留每个别名的 `Typeface`（`typeface(alias)`），用来读下划线、删除线的位置和粗细。
- 所有段落共用一个 `FontCollection`（`getCollection()`：`FontCollection.Make()` + `setDefaultFontManager(provider)` + `enableFontFallback()`），用 `ParagraphBuilder.MakeFromFontCollection` 建段落。有字体加载完就删掉重建，因为集合会记住"这个名字找不到"的结果。（2026-10-28）
  > 2026-10-27 → 2026-10-28 修订：原来用 `ParagraphBuilder.MakeFromFontProvider`，它每建一个段落都新建一个 `FontCollection`，集合里的字体缓存跟着段落一起扔掉。再加上每段文字都带 `wght` 变量轴（§7.2），每建一个段落都要把用到的字体各克隆一份（`makeClone`）。Lato（`lato-font` 包的完整版，woff2 183KB）每克隆一次就多一份解压后的字体，被 Skia 的字形缓存挂着不放：家具电商一页 85 段文字反复排 5 遍，wasm 堆从 134MB 涨到 779MB；`/demo` 字体加载完那一帧重排 4437 段文字，花了 20 秒，堆涨满 2GB 后崩溃。改成共用集合、只给可变字体传变量轴以后，堆不再涨，每段文字的排版从约 8ms 降到 0.3ms（2026-10-28 实测）。

### 5.3 SVG 翻成 Skia（2026-10-27）

代码在 `engine/render/svg.ts`。矢量节点用 Figma 导出的 SVG（43542 段，2026-10-27 统计全部用例）。`recordSvg` 把一段 SVG 录成 `SkPicture`，坐标是 SVG 的 width × height。自己写了一个只认标签和属性的小 XML 解析器（`parseXml`），比 `DOMParser` 快，Node 里也能跑。

支持的范围按全部用例里实际出现的元素定：

| 元素 / 属性                                                          | 画法                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`、`rect`、`circle`、`ellipse`、`line`、`polygon`               | 转成 `Path`（`d` 用 `Path.MakeFromSVGString`），先填充再描边；`fill-rule`、线宽、线帽、拐角、`stroke-miterlimit`、`stroke-dasharray`                                                      |
| 继承的样式                                                           | `fill`、`stroke` 等按 SVG 规则从父元素继承，根 `<svg fill="none">` 也算                                                                                                                   |
| `opacity`、`style="mix-blend-mode:…"`                                | 单个图形只有填充或只有描边时把透明度乘进颜色；其他情况 `saveLayer` 合成                                                                                                                   |
| `linearGradient`、`radialGradient`                                   | `gradientUnits`、`gradientTransform`、`stop-opacity`、`xlink:href` 继承                                                                                                                   |
| `pattern` + `use` + `image`（`data:` 图片）                          | 只有一个 `use` 指向 `image` 时直接做图片着色器（线性 + mipmap 取样），否则把图案录成图片再平铺                                                                                            |
| `filter`                                                             | 按滤镜图逐个翻成 `ImageFilter`：`feFlood`、`feColorMatrix`（`SourceAlpha` 也行）、`feOffset`、`feGaussianBlur`、`feMorphology`、`feBlend`、`feComposite`、`feMerge`；滤镜区域作为图层边界 |
| `mask`                                                               | 亮度蒙版：内容先画进一层，蒙版内容再画进一层，用 `ColorFilter.MakeLuma()` 把亮度变成透明度、`DstIn` 叠回去；`maskUnits="userSpaceOnUse"` 时在蒙版层里按区域裁剪                           |
| `clipPath`                                                           | 子元素路径（各自的 `transform` 和 `clip-rule`）求并集后 `clipPath`                                                                                                                        |
| `foreignObject` 里 `background: conic-gradient(…)` 的 `div`          | Figma 导出角度渐变的方式。翻成扫描渐变（`Shader.MakeSweepGradient`），CSS 的 `from 90deg` 正好是 Skia 的 0°                                                                               |
| `foreignObject` 里 `backdrop-filter: blur(…)` + `clip-path` 的 `div` | Figma 导出背景模糊的方式。按 `div` 的 `clip-path` 裁剪后 `saveLayer(…, backdrop = 模糊)`                                                                                                  |

`data-figma-skip-parse` 的 `g` 照常画（它就是上面那个角度渐变），后面带 `data-figma-gradient-fill` 的元素本身透明，不用特殊处理。

### 5.4 裁剪和蒙版（2026-10-27）

- Frame 的 `clipsContent`：子图形裁到 frame 的圆角矩形（`clipRRect`），frame 自己的填充和描边不裁。
- Figma 的蒙版（`isMask` 节点和它上面的兄弟节点）：沿用 tldraw 版的做法（tldraw 版 tech.md §5.2），被蒙的图形和它的子树裁到蒙版图形的轮廓（矩形、椭圆或 `maskPath`）。先保证和原来一样，以后再看要不要换成真正的透明度蒙版（`saveLayer` + `DstIn`）。
- 实现：`figma/shapes/base.ts` 的 `getSubtreeClip` 用"被蒙图形页面矩阵的逆 × 蒙版图形的页面矩阵"把蒙版轮廓搬到被蒙图形的坐标系，建成 `Path`；按（蒙版图形对象，相对矩阵）缓存，变了才重建并删掉旧路径。`getClip` 返回 `outlineRRect`，按 `props` 对象缓存。
- tldraw 版为了半透明 frame 做的"挖掉上面不透明盒子"（`clip.ts` 的 `isOpaqueBox`）不需要了（§7.4）。

### 5.5 瓦片缓存（2026-10-27）

每帧把整棵树重放一遍在大稿子上太慢：948 个 SVG 滤镜每帧都要重新模糊。所以画面按瓦片缓存：

- 瓦片是 512 × 512 设备像素，按"缩放 × 设备像素比"分层，每层用 (列, 行) 定位。每块瓦片一个 GPU 离屏表面（`surface.makeSurface`），用 `makeImageSnapshot()` 贴到屏幕上。
- 平移：只贴已有的瓦片，新露出来的按每帧时间预算补画，补不完的先用别的层或总览层放大缩小顶上。
- 缩放：缩放进行中不画新层，把旧层的瓦片按比例贴；停下约 100ms 后按预算画新层。还有一张整页的低分辨率总览，任何时候都能兜底。
- 内容变化（拖动、改属性）：从 store 的 diff 算出改动图形的旧包围盒和新包围盒，标到相交的瓦片上，只重画脏矩形那一块（裁到脏矩形、清空、只画和它相交的图形）。别的层的瓦片直接作废。
- 截图模式（`?shot=1`）不用瓦片，整张直接画一次，避免瓦片边缘的背景模糊取不到外面的像素。

实现（`render/tiles.ts` 的 `TileCache`）的具体取值：

| 项                 | 取值                                                                                                                                      | 理由                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 瓦片大小           | 512 × 512 设备像素，约 1MB 一块                                                                                                           | 脏矩形够细，贴图调用不多                          |
| 缩放中用的层       | 缩放倍数按 1/4 个八度取整（`2^(round(log2 s × 4) / 4)`），贴的时候最多放大缩小约 9%                                                       | 缩放每帧都在变，按精确倍数分层就每帧都要重画      |
| 停下多久算缩放结束 | 120ms，之后按精确倍数画新层                                                                                                               | 停下后画面要清楚                                  |
| 补画的单位         | 一块瓦片分成 16 片 128 × 128，总览分成 512 × 512 的片；画完一片就 `flush()`                                                               | 一片的耗时可控，`flush` 把 GPU 那边的活也算进预算 |
| 每帧补画预算       | 8ms，从视野中心往外补，停着时至少补一片；缩放进行中只给 40%（约 3ms），也不强制补                                                         | 留时间给贴图和选框层；缩放中先用旧层顶着          |
| 脏块               | 当前层的脏矩形按 128 像素的格子合并（同一格里的取并集），和新瓦片一起按预算重画；没画完的瓦片继续贴旧图，画完一起换。别的层的脏块直接扔掉 | 两万多个图形一起加载时每块瓦片会收到几百个脏矩形  |
| 总览               | 整页内容画进一张最长边 2048 像素的图，按片在预算里补；新的画完之前一直贴旧的                                                              | 任何地方都有东西兜底                              |
| 淘汰               | 只留当前层和一个最近用过的层；瓦片总数超过"可见块数 × 2 + 32"时按最近使用淘汰                                                             | GPU 内存有上限                                    |

瓦片贴到屏幕时，位置取整到设备像素、用最近邻采样（倍数正好时），所以平移时画面不会糊；倍数不对时用线性采样。

> 2026-10-27 → 2026-10-28 修订：原来一块瓦片整块画（每帧至少一块），当前层的脏块马上重画、不受预算限制，总览第一次整张画完。`/demo`（22100 个图形）上这三条都会出长帧：整面墙缩小时一块瓦片里有上千个图形，画一块要 25～40ms；图片的某一档解码好以后，用到它的图形全部标脏，脏块一口气重画，帧间隔 100～200ms；Skia 的活大部分在 `flush` 时才做，原来的预算只量了录制的时间。改成分片、`flush` 计时、脏块也按预算以后，整面墙缩放从 46fps 到 60fps（2026-10-28 实测，verification.md §4）。

### 5.6 选框层（2026-10-27）

选中框、8 个缩放控制点、旋转区、悬停描边（图形几何的轮廓）、框选矩形、对齐线每帧画在瓦片上面，线宽按屏幕像素算（除以缩放），颜色用 Figma 的蓝 `#0D99FF`。

实现（`render/overlay.ts` 的 `OverlayRenderer`）：在 CSS 像素坐标里画（画布先 `scale(dpr)`）。选中框用 `getSelectionRotatedPageBounds` 加 `getSelectionRotation` 算四个角；多选时每个图形再描一圈轮廓。控制点 8 × 8 白底蓝边，只画四个角；拖动、缩放、旋转、框选和编辑文字时不画控制点（编辑时选中框照画，和 tldraw 一样）。悬停描边 1.5px，只在 `select.idle` / `select.pointing_canvas` 画。对齐线红色 `#F24822`，每个点画一个小叉。

颜色从容器的 CSS 变量 `--color-selection-stroke` / `--color-selection-fill` 读（没有就用默认蓝），所以 tldraw 版"组件选中变紫"（`figma-component-selected` 类，tldraw 版 tech.md §16.4）不用改就能用。

CSS 颜色先用自己的 `parseCssColor` 解析 `rgb()` / `rgba()`（逗号和空格两种写法，透明度可以是小数或百分比），解析不了再交给 CanvasKit 的 `parseColorString`（十六进制、颜色名）。顺序不能反：`parseColorString` 不认 `rgb(13 153 255 / 8%)` 这种空格写法，也不报错，直接返回不透明的黑色，框选矩形就成了一整块黑（2026-10-27 快捷键脚本发现）。

`getHandleAt(点)` 做控制点命中测试：先四个角（6px 内）→ 四条边（4px 内）→ 角外 16px 内算旋转区。按下时命中就把事件的 `target` 设成 `'selection'`、带上 `handle`，选择工具照 tldraw 的约定进入缩放或旋转。

### 5.7 导出一块区域的像素（2026-10-27）

`CanvasController.readArea(area, scale, background)` 把当前页的一块区域（页面坐标）按 `scale` 画进一张离屏 GPU 表面（`surface.makeSurface`），`readPixels` 读回 RGBA（非预乘）。不经过屏幕、不受相机和视口影响，所以能导出比窗口大的区域。`exportArea(...)` 是异步版：画完看有没有图片、字体还在加载或图形录得不完整，有就等 `resources.whenIdle()` 再画，最多 10 次——视野外的图形平时不画，它们要的资源要到这时才开始加载。

`/import` 页的对比（`importer/shot-stage.tsx`）用它代替原来的 `modern-screenshot` DOM 截图：按 2 倍分条（每条不超过 1600 万像素）导出，`putImageData` 拼成整张图，不再需要挪相机、留 40px 白边和 0.125px 的 tldraw 图层偏移。

### 5.8 拖动时的抬起和滑动（2026-10-27）

tldraw 版在自动布局里拖动排序时，用一段 CSS 做两件事（tldraw 版 tech.md §13.6）：被拖的图层 `z-index` 提到最上面，别的图形的 `transform` 加 0.15 秒过渡，被挤开的兄弟会滑过去。画布换成 Skia 以后没有 DOM 元素可加样式，所以这两件事挪进场景渲染器 `render/renderer.ts` 的 `SceneRenderer`，只影响画面，数据里的位置照样一步到位（撤销、点选、吸附都按最终位置算）。

| 接口             | 作用                                                                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setLifted(ids)` | 这些图形在正常遍历里跳过，整页画完后按给的顺序再画一遍（`drawLifted`）。父级链上的变换、`clipsContent` 裁剪和透明度照样套上，所以被拖的图层还在原来的 frame 里被裁剪，只是叠在所有图形上面。父级的蒙版（`getSubtreeClip`）和混合模式不套。传 `[]` 取消。                   |
| `setSlideMs(ms)` | 大于 0 时，图形的 `x` / `y` 一变（同一个父级、旋转没变、不在抬起的集合里），就记一段滑动：从旧位置到新位置，按 CSS `ease-in-out`（`cubic-bezier(0.42, 0, 0.58, 1)`，`easeInOut`）走 `ms` 毫秒。滑到一半又变了，从当前画面上的位置接着滑。传 0 不再记新的，已经在滑的滑完。 |
| `tick(now)`      | 控制器每帧开头调用（`render/controller.ts` 的 `frame`）：把每段滑动扫过的区域（新位置和起点位置的并集）记成脏区，滑完的删掉；还有在滑的就再要一帧。                                                                                                                        |

画的时候，滑动中的图形在父空间里先平移当前偏移，再乘自己的局部变换，子图形跟着一起动（tldraw 版每个 `.tl-shape` 各自过渡，时间一样，看起来也是一起动）。滑动中的子树不往 `pageBounds` 缓存里写，免得滑完以后缓存里留着中间位置。

Figma 编辑代码 `figma/editing/drag-style.ts` 的 `installDragStyle` 只是调用方：第一次检测到拖动自动布局里的图层时，把选中的图层连同子图层按原来的上下顺序传给 `setLifted`，`setSlideMs(150)`；离开 `select.translating` 0.15 秒后两个都清掉，让最后一次交换滑完。没有画布控制器（单元测试里）时什么都不做。

实测（2026-10-27，Playwright，`/canvas?case=page/mobile-login`，把 Sign in 按钮往上拖）：越过 "Options" 的中线后两者交换，"Options" 的画面偏移 −62 → −58.5 → −48.7 → −35.4 → −21.6 → −10.7 → −2.8 → 0，每 20 毫秒一个点，约 150 毫秒走完，先慢后快再慢；被拖的按钮压在密码输入框上面；松手后抬起清掉，⌘Z 一次恢复顺序。`scripts/bench.ts` 的自动布局拖动仍在 230fps 以上（verification.md §4）。

## 6. 工具和交互（`engine/tools/`、`engine/editor.ts`）（2026-10-27）

`StateNode` 和 tldraw 一样：`static id`、`initial`、`children`，`transition('a.b', info)` 走点分路径，事件先交给父状态再交给当前子状态，`onEnter` / `onExit` / `onPointerDown` / `onPointerMove` / `onPointerUp` / `onDoubleClick` / `onKeyDown` / `onKeyUp` / `onWheel` / `onCancel` / `onComplete` / `onInterrupt` / `onTick`。根状态在 `Editor` 构造时用 `[SelectTool, HandTool, ...tools]` 拼出来，默认 `select`。

`editor.dispatch(info)` 更新 `editor.inputs`（当前 / 上次 / 按下时的屏幕和页面坐标、按键、是否在拖动），按下后移动超过 4 像素（16 平方像素）才算开始拖动；双击在第二次抬起、没有拖动时才发出。

选择工具（`tools/select.ts`）的子状态：`idle`（悬停用 `getOutermostSelectableShape` 找最外层可选图形）、`pointing_canvas`、`pointing_shape`、`pointing_selection`、`brushing`（框选；按住 Ctrl 只选完全框住的）、`translating`（拖动开始打历史标记，Shift 锁轴，按 `isSnapMode` 和 Ctrl 决定吸附，Esc 用 `bailToMark` 退回）、`pointing_resize_handle`、`resizing`（支持旋转过的选区、Shift 锁比例、`canResizeChildren`、新建工具用的 `isCreating`）、`pointing_rotate_handle`、`rotating`（Shift 按 15° 吸附）、`editing_shape`。

抓手工具（`tools/hand.ts`）：按下拖动平移相机。

相机：屏幕坐标 = (页面坐标 + 相机) × 缩放，缩放范围 0.02～64，每页一个相机。`zoomToBounds` / `zoomToSelection` / `zoomToFit` / `zoomAt` / `pan`。

### 6.4 对齐线（`engine/snaps.ts`）

`SnapManager` 的默认可吸附图形是选区的兄弟里在屏幕上的那些，`figma/editing/snapping.ts` 照旧可以替换 `getSnappableShapes`。阈值 8 屏幕像素，对齐左中右、上中下，命中的线存进 `indicators` atom，由选框层画出来。

### 6.5 输入和坐标（`engine/react/input.ts`）（2026-10-27）

坐标约定和 tldraw 一样：事件里的 `point` 和 `screenToPage` / `pageToScreen` 用的是窗口坐标（`clientX/Y`）；`editor.inputs.currentScreenPoint` 和 `zoomAt` 的锚点是相对视口左上角的坐标（`viewportToPage` / `pageToViewport`）。起初写成了全部用视口坐标，换成 tldraw 的约定后编辑代码不用改。

- 指针：只处理落在 `<canvas>` 上的事件（工具栏、面板、文字编辑框自己处理），按下时 `setPointerCapture`、让容器拿到焦点。双击和 tldraw 一样分两段发：第二次按下时发 `double_click`（`phase: 'down'`），松开且没拖动时再发一次（`phase: 'up'`）；选择工具的空闲状态只认 `up`——第二次按下时它已经进了 `pointing_shape`，松开后才回到空闲。原来只在按下时发一次，空闲状态收不到，双击进不了文字编辑（2026-10-27 交互脚本发现）。`setPointerCapture` 包在 try/catch 里：脚本派发的合成事件（`scripts/bench.ts`）没有真实的指针，捕获会抛 `NotFoundError`，不捕获照样能拖。按下时先问选框层有没有点到控制点（§5.6）。中键或按住空格拖动直接平移相机，不进状态机。悬停在控制点上时光标换成对应的缩放箭头。
- 滚轮：按住 Ctrl / ⌘（触控板捏合也是 Ctrl + 滚轮）按指针位置缩放，系数 `exp(−Δy × 0.01)`，Δy 夹在 ±30；否则平移。行模式、页模式的 Δ 换算成像素（×16、×400）。
- 键盘：挂在 `window` 上，焦点在输入框、可编辑区域里时不管；焦点在别的地方（例如侧栏）时也不管。先匹配动作快捷键，再匹配工具快捷键，都没命中才把按键发给状态机；Esc 额外发 `cancel`。

### 6.6 动作、工具栏和覆盖（`engine/react/actions.ts`、`engine/react/ui.tsx`）（2026-10-27）

和 tldraw 一样，`overrides.actions(editor, actions, helpers)` / `overrides.tools(editor, tools, helpers)` 拿到默认的动作表和工具表，改完返回；快捷键写法也一样（`$` 是 ⌘ / Ctrl，`!` 是 Shift，`?` 是 Alt，或者 `cmd+alt+k,ctrl+alt+k`），按键码匹配，所以 Mac 上 Alt 组合键出来的特殊字符也能匹配。

默认动作：撤销 `$z`、重做 `$!z` / `ctrl+y`、全选 `$a`、复制一份 `$d`、复制 / 剪切 / 粘贴 `$c` / `$x` / `$v`（引擎内的剪贴板，原位置粘贴）、放大缩小 `$=` / `$-`、`!0` 100%、`!1` 适应全部、`!2` 适应选区。删除、回车进入编辑、方向键微移由选择工具自己处理（§6）。默认工具：选择 `v`、抓手 `h`，注册了画笔、箭头工具时再加 `d`、`a`。

界面组件和 tldraw 同名：`DefaultToolbar`、`ToolbarItem`、`SelectToolbarItem`、`HandToolbarItem`、`DrawToolbarItem`、`ArrowToolbarItem`、`DefaultStylePanel`（只是右上角的容器，没有 tldraw 自带的样式项）、`useTools`、`useActions`。图标用 lucide，标签按 tldraw 的翻译键给中文。`<SkiaCanvas components>` 支持 `OnTheCanvas`（随相机移动缩放的 DOM 层）、`InFrontOfTheCanvas`、`Toolbar`、`StylePanel`。

### 6.7 文字编辑（`engine/react/rich-text.tsx`、`figma/editing/text-editor.tsx`）（2026-10-27）

仍然用 TipTap：`figma/editing/rich-text.ts` 的 `toRichText` / `fromRichText`（Figma 的字符 + 每字符样式键 ↔ TipTap 文档，tldraw 版 tech.md §13.3）和它的测试原样保留。引擎提供和 tldraw 同名的 `TLRichText`、`TLTextOptions`、`tipTapDefaultExtensions`（Document、Paragraph、Text、HardBreak、History、Bold、Italic、Strike，都是 `@tiptap/*` 2.27.3，原来 tldraw 间接装过，现在直接依赖）和 `RichTextArea`。

- 编辑时引擎在相机层里按图形的页面矩阵放一个 DOM 层，里面是 `ShapeUtil.editingComponent(shape)` 的内容（`react/skia-canvas.tsx` 的 `EditingLayer`）。
- Figma 文字的编辑框 `FigmaTextEditor` 用 CSS 排版（字体、字号、行高、字间距、对齐、换行和 tldraw 版一样），所以和 Skia 画出来的字有细小差别；编辑中这个图形的 Skia 画面隐藏，只看 DOM。隐藏的做法：每帧开始时 `CanvasController` 看正在编辑的图形有没有 `editingComponent`，有就交给 `SceneRenderer.setHidden(id)`；换了隐藏对象时把新旧两个图形的范围标脏，瓦片只重画这一块。画的时候跳过它自己的图片（子图形照画）。
- `setEditingShape` 和 tldraw 一样只记下正在编辑哪个图形、调 `onEditEnd`，不切换工具状态；新建文字（`figma/editing/tools.tsx`）就是这样直接进入编辑的。
- 每次输入用 `fromRichText` 写回 `node`；Esc 或失焦时 `editor.complete()`，`onEditEnd` 里空文字删掉。
- `RichTextArea` 给 TipTap 生成的 `.ProseMirror` 元素直接写 `outline: none; white-space: inherit`（`editorProps.attributes`）：tldraw 版靠 `tldraw.css` 去掉聚焦时的浏览器描边，现在没有这个文件了。段落间距靠 `figma.css` 的 `.figma-text-editing .tl-rich-text p` 规则，所以 `figma-text-editing` 类要放在外层容器上，不能和 `tl-rich-text` 放在同一个元素上。

### 6.8 画笔和箭头（`engine/shapes/`）（2026-10-27）

tldraw 版工具栏保留了 tldraw 的画笔和箭头（用户定的）。本引擎各写一个简化版，图形类型名和 tldraw 一样（`draw`、`arrow`），props 取 tldraw 的子集：

- `draw`：`segments`（点相对图形原点）、`color`、`size`、`isComplete`。按下开始一条线，移动时追加点，抬起结束，工具不切走。线用二次曲线穿过相邻点的中点，圆头圆角，粗细 s / m / l / xl = 2 / 3.5 / 5 / 10。
- `arrow`：`start`、`end`、`arrowheadStart`、`arrowheadEnd`、`color`、`size`。拖出一条直线，箭头两边各 30°；松手后选中箭头并回到选择工具。
- 命中测试用 `Polyline2d`（点到折线的距离 ≤ 半线宽 + 容差）。颜色用 tldraw 浅色主题的色值。
- 和 tldraw 一样作为默认值导出（`engine/defaults.ts`）：`defaultShapeUtils = [DrawShapeUtil, ArrowShapeUtil]`、`defaultShapeTools = [DrawShapeTool, ArrowShapeTool]`、`defaultTools = [SelectTool, HandTool]`。`<SkiaCanvas>` 像 `<Tldraw>` 一样自动把默认图形类和工具并进 `shapeUtils` / `tools`，传进来的同名（`type` / `id` 相同）优先。工具栏按钮 `DrawToolbarItem`、`ArrowToolbarItem` 只在工具注册了时才显示。

## 7. Figma 图形的 Skia 画法（`figma/skia/`）（2026-10-27）

四种图形（`figma-frame`、`figma-rect`、`figma-text`、`figma-vector`）的数据和 `to-shapes.ts` 的转换都不变，只是 `paint()` 换成 Skia。

### 7.1 盒子：填充、描边、阴影、模糊（`paints.ts`、`box.ts`）

`paintBox` 按这个顺序画矩形、椭圆和 frame：背景模糊 → 投影 → 填充 → 内阴影 → 描边。轮廓是圆角矩形（`clampRadii` 和 CSS 一样按比例缩小超大圆角），椭圆是四个角都是半径的圆角矩形。

| 效果            | 画法                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SOLID           | 颜色 × 填充透明度                                                                                                                                                                                                                                |
| 线性 / 径向渐变 | `MakeLinearGradient([0,0]→[1,0])` / `MakeRadialGradient([0,0], 1)`，局部矩阵 = `gradientMatrix()`（渐变空间到像素，tldraw 版 tech.md §6.1），所以斜着、拉伸的渐变和 Figma 一致                                                                   |
| 角度渐变        | `MakeSweepGradient(0, 0)`，同一个矩阵；Skia 从 +x 往 +y 转，和 Figma 从 p1 方向顺时针一致                                                                                                                                                        |
| 菱形渐变        | 运行时着色器（SkSL）：用 `                                                                                                                                                                                                                       | s   | +   | t   | ` 去查一条线性渐变 |
| 图片            | 图片着色器：FILL 按 cover、FIT 按 contain 居中；TILE 按 `imageSizes × scalingFactor` 平铺；STRETCH 的矩阵 = `S(w,h) · imageTransform⁻¹ · S(1/图宽, 1/图高)`；有滤镜时用插件渲染好的图（tldraw 版 tech.md §6.8）；取样用线性 + mipmap             |
| 填充的混合模式  | 画笔的 `setBlendMode`                                                                                                                                                                                                                            |
| 投影            | 轮廓按 spread 放大（圆角按 CSS 的公式放大），偏移，`MaskFilter.MakeBlur(σ = radius / 2)`；`showShadowBehindNode` 为 false 时先把轮廓里面裁掉（和 CSS 的 box-shadow 一样）。只有描边没有填充时，画的是描边那一圈的阴影（tldraw 版 tech.md §12.4） |
| 内阴影          | 裁到轮廓里，画"大矩形挖掉偏移、收缩后的轮廓"（`drawDRRect`）并模糊                                                                                                                                                                               |
| 背景模糊        | 有可见填充时（tldraw 版 tech.md §12.6），裁到轮廓，两层 `saveLayer`：外层的背景滤镜是什么都不做的 `MakeOffset(0, 0)`，只把轮廓范围里已经画好的像素拷进来；内层的背景滤镜是模糊（σ = radius / 2），边缘镜像取样。见表下的说明                     |
| 描边            | 内 / 中 / 外对齐按 tldraw 版 §6.2 缩放矩形和圆角；虚线按每条边、每个圆角单独铺整数个周期（`fitDashes`、`roundedRectPieces`）；四边粗细不同时画"外圆角矩形减内圆角矩形"（`drawDRRect`），内圆角按 CSS border 的规则减去相邻边的粗细               |
| 图层模糊        | 作用在整棵子树上（`getLayerStyle`），见 §7.4                                                                                                                                                                                                     |

背景模糊为什么要两层（2026-10-27）：Skia 的背景滤镜会读图层范围**外面**的像素（模糊要往外取 3σ），不管 `saveLayer` 给不给范围、`backdropTileMode` 设成什么（实测 CanvasKit 0.41：上面一条红色、下面黑色的 frame 带 σ = 7 的背景模糊，frame 顶边是 120 / 255 的红）。Figma 不会把框外的颜色模糊进来（`dark-page-desktop` 的导航栏紧挨着上面粉色的横条，Figma 截图里导航栏顶边还是纯黑）。先用一层"原样拷贝"把内容限制在轮廓范围里，内层的模糊再往外取时，外层范围外面没有像素，就按镜像补边。原来在截图模式下这个问题看不出来，是因为 GL 上下文没带 alpha 时读回背景直接失败（§5），背景模糊等于没画。

渐变颜色先按 Skia 默认的"不预乘透明度"插值，和 Chrome 画 SVG 渐变一样；有没有偏差等 `fill/gradient-alpha` 用例的结果再定。

### 7.2 文字（2026-10-27）

代码在 `figma/skia/text.ts`、`figma/font-metrics.json`。只借 Skia 的段落排版（`ParagraphBuilder`）做两件事：断行和整形（连字、字距、字体回退）。每一行放在哪由自己算：

1. 按 `characterStyleOverrides` 切成样式段（`textRuns`），按 `\n` 切段落，大小写变换（`textCase`）在这一步做。U+2028 不用换掉，Skia 当成强制换行（实测）。居中和右对齐、宽度不自动时去掉段尾空格（tldraw 版 tech.md §15.1）。
2. 每个段落建一个 Skia 段落，按文本框宽度排版（宽度自动时给一个很大的宽度），从 `getLineMetrics()` 拿到每一行的起止位置。
3. 每一行再单独建一个只有一行的段落，用来画。行宽用它的 `getMaxIntrinsicWidth()`（不含行尾空格）。水平位置按对齐方式算。
4. **基线按 Figma 的规则算**（tldraw 版 tech.md §6.4 找到的规律）：一行的上半 = `a × 字号 + (行高 − (a + d) × 字号) / 2`，下半 = 行高 − 上半；`a`、`d` 是字体的上沿、下沿除以 UPM（用哪一组见下面"typo 上下沿从哪来"）。一行里比基础行高大的样式段决定这一行的上半和下半（各取最大值），否则用基础样式的。**行和行按"下一行的整个行高"往下排**：第一行基线 = 它的上半；后面每一行的基线 = 上一行基线 + 段落间距（跨段落时）+ 这一行的上半 + 这一行的下半；总高度 = 最后一行基线 + 它的下半。垂直居中、底对齐按总高度算偏移，自动高度的文本框差不超过 0.5px 时居中补齐；**每一行的基线四舍五入到整像素**（1 倍坐标）。
   > 2026-10-27 修订：原来下一行的基线 = 上一行基线 + 上一行的下半（固定用基础样式的）+ 这一行的上半。理由：`designs-48` 的 "We are / digital / studio" 三段字号是 88、128、88，Figma 里 "digital" 的基线离 "We are" 是 48 + 154（= 128px 那段的整个行高），按原来的算法少了 11.75px，"studio" 少了 17.75px（量的是两张图里字形的上下边缘，2 倍图）。两种算法只在"非第一行里有更大的字"时不同，`text/mixed-styles` 的大字在第一行，两种结果一样（框高 60）。
   - 样式覆盖表里的行高是"自动"（`INTRINSIC_%`）、字体和基础样式一样时，行高按基础样式的比例乘这一段的字号，不用覆盖表里的 `lineHeightPx`：`designs-48` 里一段 88px 的 Lato Bold 写着 103.125（1.172 倍），Figma 实际按 1.2 倍排（全部用例只有这一处对不上）。
   - 字间距按百分比继承：覆盖表只改了字号、没写字间距，而基础样式的字间距正好是字号的整百分比（精确到 0.1%）时，按这一段的字号重新算。Figma 存的是百分比（"1%"），REST 只把基础字号换算成了像素；覆盖表里没有字间距说明内部的值和基础样式一样。`designs-48` 的 72px 写 0.72px，128px 那段实际是 1.28px（"digital" 宽了约 3.5px，全部用例只有这一处）。
5. 字间距：Skia 在每个字的前后各加一半字间距，Chrome 和 Figma 是加在后面，所以整行左移半个字间距（2026-10-27 实测：16px 的 "Hello" 加 2px 字间距，第一个字从 x = 1 开始）。
6. 下划线和删除线自己画：位置和粗细从字体里读（`Font.getMetrics()` 的 `underlinePosition` 等，Inter 的值和 tldraw 版记的 464 / 192 / 922 一致），下划线的上边缘在下划线位置再往下半个线粗，删除线的上边缘在删除线位置（tldraw 版 tech.md §6.4）。
7. 截断（`textTruncation: ENDING`）：最后一行改成从行首到段落末尾、`maxLines: 1` 加省略号重新排。
8. 渐变文字：普通的那一遍里渐变段透明；再画一遍"渐变段黑色、其他透明"的蒙版，`SrcIn` 盖上按文本框算的渐变（tldraw 版 tech.md §6.7）。

字体选择（`resolveFont`）：先是稿子里的字体；Inter 斜体换成 `InterVariable` 加 `slnt = −10`；Product Sans 后面接 Google Sans Flex（`wdth 93.5`、`opsz 18`，tldraw 版 tech.md §6.9）；最后是 Inter 和 Noto Sans SC。只有用到可变字体（`InterVariable`、Google Sans Flex）时才带变量轴（`wght` 加上面那些），其余都是静态字体文件，不带。

> 2026-10-27 → 2026-10-28 修订：原来所有样式都带 `wght` 变量轴，静态字体会忽略它，画面一样。但 Skia 见到变量轴就把段落用到的每个字体都克隆一份，内存和时间都浪费（§5.2）。

**typo 上下沿从哪来**：CanvasKit 的 `Font.getMetrics()` 给的是 hhea（字体开了 USE_TYPO_METRICS 时才是 typo），读不到 typo 的原始值，woff2 又要 brotli 解压，浏览器里没有。所以 `apps/client/scripts/font-metrics.ts`（新）在 Node 里从 `figma.css` 引用的每个字体文件抽出 `head` 的 UPM、`hhea` 和 `OS/2` 的上沿、下沿、行距和 USE_TYPO_METRICS 位，按 family 写进 `src/figma/font-metrics.json`（17 个字体族，同一族各字重的值都一样）。**typo 的行距（lineGap）不为 0 的字体改用 hhea**（Lato、Zilla Slab），其余用 typo（Noto Sans SC 是 typo，tldraw 版验证过）。实测 Lato：typo 0.805 / 0.195 加 0.2 的行距，hhea 0.987 / 0.213；用 typo 时 Lato 的字整体偏高（88px 偏 7px 左右），33 个 Lato 用例里 12 个超过 1%；改用 hhea 后全部降到 1.4% 以下（2026-10-27，`reports/fidelity/20261027-214727`）。加新字体后运行 `pnpm --filter @figma-to-tldraw/client exec tsx scripts/font-metrics.ts` 重新生成。表里没有的字体退回 Skia 的 hhea 值。

### 7.3 矢量（2026-10-27）

`figma-vector` 画 `resources.svgPicture(svg)`，从 SVG 的 width × height 拉伸到图形的 w × h（和 tldraw 版 `preserveAspectRatio="none"` 一样）；`flipX` 时先 `translate(w, 0)`、`scale(−1, 1)`，只翻图形自己，不翻裁剪（tldraw 版 tech.md §12.3）。矢量的透明度已经写在 SVG 里，图形记录上的 `opacity` 仍然是 1（tldraw 版 tech.md §4.1）。代码在 `figma/shapes/figma-vector.ts`；绘制范围是 w × h 外扩 2px，因为 Figma 导出 SVG 时尺寸就是渲染范围（含阴影）。

SVG 里 `fill`、`stroke`、`clip-path`、`mask`、`filter` 只认 `url(#id)`，`#id` 写法只在 `href` 里算引用（`svg.ts` 的 `urlId` 和 `refId`）。2026-10-27 第一次在浏览器里跑时 `fill="#F59E0B"` 被当成了 id 引用，所有纯色矢量都没画出来。

### 7.4 和 tldraw 版的差别（2026-10-27）

- **组透明度、混合模式、图层模糊作用在整棵子树上。** tldraw 把透明度乘到每个图形上，半透明 frame 里重叠的子图形会透出来，所以 tldraw 版的 `clip.ts` 要用"挖掉上面不透明的盒子"去补；现在套一层 `saveLayer` 就和 Figma 一样，不用补。frame 的图层模糊也会模糊它的子图形（Figma 就是这样；用例里没有带子图形的图层模糊）。
- **截图不用偏移。** tldraw 的图形层有 0.125px 的偏移（`TLDRAW_LAYER_OFFSET`），现在相机直接按渲染范围放。
- **文字基线直接按 Figma 算**，不用再算 Chrome 的基线去补差（tldraw 版的 `baselineShift`）。

### 7.5 文字排版缓存（2026-10-28）

`figma/shapes/figma-text.tsx` 的 `FigmaTextShapeUtil` 缓存两样东西，键都是图形 id，`props` 对象没变、录得完整（或资源版本没变）就算新鲜（`isFresh`）：

| 缓存                     | 存什么                                                     | 上限                                                                        |
| ------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `layouts`（`getLayout`） | 完整的排版结果：每一行的 Skia 段落，`paint()` 直接拿来画   | 最近用过的 64 个（`LIVE_LAYOUTS`），多了按最近使用 `disposeLayout` 释放段落 |
| `extents`（`getExtent`） | 所有行框的并集（`lineExtent`），`getRenderBounds` 只要这个 | 不限，每个图形 4 个数                                                       |

图形删除时两样都清掉。

理由：一个 Skia 段落带着整形结果和字形缓存的引用，在 wasm 堆里约几十 KB。`/demo` 有 4437 段文字，原来每段的排版都一直留着，加上 §5.2 说的字体克隆，堆涨满 2GB。现在算范围（`getRenderBounds`，视野裁剪每帧都要）只用 `extents`，不用留段落；真正要画的时候才排版，画完录成图片（§5 第 4 步）后段落就没用了，所以只留最近的 64 个，给编辑文字时反复重画用。（2026-10-28 实测：整面墙加载完 wasm 堆 161～193MB。）

## 8. 和现有代码的关系（2026-10-27）

- `figma/editing/`、`figma/editor.ts`、`figma/to-shapes.ts`、`figma/components.ts` 等只换 import（`'tldraw'` → `'../engine'`）。用到 tldraw DOM 的地方要改：`drag-style.ts` 用 CSS 过渡做的拖动动画、`text-measure.tsx` 用 DOM 量文字（改成 §7.2 的排版）、`figma-text.tsx` 的 TipTap 编辑框（换成盖在画布上的可编辑 `div`）。
- 页面：`pages/canvas.tsx` 的 `<Tldraw>` 换成 `<SkiaCanvas>`，props 一一对应（`shapeUtils`、`tools`、`components`、`overrides`、`options`、`getShapeVisibility`、`hideUi`、`onMount`）；`/import` 页原来用 modern-screenshot 截 DOM，改成直接把 Skia 画面导出成 PNG。
- 对比脚本 `scripts/compare.ts` 不用改：它截的是页面，画面是 DOM 还是 canvas 都一样。

## 9. 风险

| 风险                                                                                                 | 应对                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skia 的字形光栅化（抗锯齿、hinting）和 Figma 不同，文字边缘的像素差会比浏览器大                      | 先跑全量看文字类用例的差异；必要时调 `Font` 的 edging / hinting / subpixel。2026-10-27 结果：没调这些设置，文字类用例全部 < 1%，差的像素主要在字形边缘                                                               |
| 渐变插值（预乘还是不预乘）、背景模糊的边缘取样（镜像还是夹边）和 Figma 不同                          | 用 `fill/gradient-alpha`、`effect/background-blur` 用例对比两种设置。2026-10-27：背景模糊改成两层 `saveLayer`（外层夹边复制、内层镜像模糊），`effect/background-blur` 0.00%（§7.1）；渐变用默认设置，两个用例都 < 1% |
| 文字基线规则只在 Inter 和 Noto Sans SC 上验证过；Lato 等字体 typo 和 hhea 不一样，Figma 用哪组没验证 | 2026-10-27 已查清：typo 行距（lineGap）不为 0 的字体（Lato、Zilla Slab）Figma 用 hhea 上下沿，改了以后 33 个 Lato 用例全部变好（§7.2）                                                                               |
| PIXELS 行高是小数时 Figma 每行怎么取整，未验证                                                       | 现在每行基线各自四舍五入；没有单独验证，`text/*` 用例全部 < 1%（2026-10-27）                                                                                                                                         |
| 没有填充的 frame 带投影时，Figma 用子图形的轮廓投影，现在按盒子画（11 个节点，2026-10-27 统计）      | 看对应用例的差异再决定要不要改成按子树轮廓投影。2026-10-27：涉及的用例都 < 1%，没改                                                                                                                                  |
| 瓦片边缘的背景模糊取不到瓦片外的像素                                                                 | 截图模式不用瓦片；交互时接受，或者给含背景模糊的瓦片多画一圈                                                                                                                                                         |
| WebGL 上下文丢失、GPU 内存（瓦片约 1MB 一块）                                                        | 瓦片总数设上限按最近使用淘汰；上下文丢失时重建表面、清空所有缓存                                                                                                                                                     |
| 无头 Chromium 的 WebGL 走软件渲染（SwiftShader），对比脚本可能变慢                                   | 实测后再决定 worker 数                                                                                                                                                                                               |
| `createImageBitmap` 的 `resizeWidth` / `resizeQuality` 各浏览器支持不一样（Safari 未验证）           | 缩小解码失败时这一档记为失败，退回原图那一档（`getLevel`）。只在 Chromium 上测过（2026-10-28）                                                                                                                       |
| 浏览器缩小解码的图和 Skia 从原图 mipmap 取样的结果略有差别                                           | 截图模式也用分级（2 倍图），全量对比结果见 verification.md §4（2026-10-28）                                                                                                                                          |
| 解码好的 `ImageBitmap` 占浏览器内存，没有上限                                                        | 每张图最多留 3 档；切到很多张图的原图档时内存会涨，没测上限（2026-10-28）                                                                                                                                            |
| 缩放进行中新层不强制补画，大场景里缩放时画面先糊、停下约 120ms 后变清楚                              | 和 Figma 的表现一致；需要更快变清楚时调 `ZOOMING_BUDGET`                                                                                                                                                             |

## 10. 总览 Demo 页 `/demo`（2026-10-27，用户追加）

产品要求见 [product.md §7](product.md#7-总览-demo-页-demo2026-10-27用户追加)。

### 10.1 文件

| 文件                                    | 内容                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/client/src/routes/demo.tsx`（新） | 路由，`?copies=` 参数                                                        |
| `apps/client/src/pages/demo.tsx`（新）  | 页面：`<SkiaCanvas>`、加载、标签层、左上角面板                               |
| `apps/client/src/demo/layout.ts`（新）  | 纯函数 `layoutWall`：用例分块、块内排行、块再排成整面墙                      |
| `apps/client/src/demo/load.ts`（新）    | 按顺序并发加载用例、转成图形、平移到墙上的位置后放进编辑器                   |
| `apps/client/src/demo/demo.css`（新）   | 标签层的样式：抵消缩放、按 `--label-w` 截断、类别名的 `--label-gap`（§10.5） |

### 10.2 数据量（2026-10-27 实测）

| 项                                             | 数                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 用例                                           | 175（基础 87、真实稿子 88）                                                                                  |
| 转出来的图形（`snapshotToShapes`，不要主组件） | 22100：Untitled UI 9650、家具电商 6614、golio 3314、50 个落地页 1063、SaaS 532、e-learning 510、基础用例 417 |
| `snapshot.json` 原文件合计                     | 937MB（带缩进；Untitled UI 一页 30～40MB，其中主组件 `mains` 占大半）                                        |
| 去掉 `mains`、去掉缩进后合计                   | 212MB，其中 golio 5 页 140MB（SVG 里内嵌了图片）                                                             |

不带 golio 只有 18786 个图形，不够 2 万，所以 175 个全放。

### 10.3 排版（`layoutWall`）

输入是 `cases/index.json` 里每个用例的 `dir`、`width`、`height`，不用等快照加载就能算出整面墙，打开页面就能先把相机对准全部。

1. **分块**：基础用例按 `dir` 第一段分（`fill`、`stroke`……），真实稿子按第二段分（`real/<套>`）。块的顺序：基础用例在前，真实稿子在后，都按 `index.json` 里的顺序。
2. **块内**：按行排（shelf packing），从左往右放，放不下换行；行高取这一行最高的用例。块的最大宽度取 `max(最宽的用例, √(块内面积和) × 1.6)`，让块大致是横长方形。用例之间留 `GAP`（板宽的 10%，至少 80px），给阴影和标签留地方。
3. **整面墙**：块也按行排，最大宽度 `√(所有块面积和) × 1.8`，块之间留更大的间距，块上方留出类别名的位置。
4. `copies > 1` 时整面墙按 2 列网格重复，第 k 份的用例 id 前缀是 `<dir>~k`。

### 10.4 加载（`loadWall`）

- 顺序：按快照文件大小从小到大（`index.json` 没有大小，用节点数近似：`width × height` 小的先），golio 的长页面最后；同时最多 4 个请求。
- 每个用例：`loadCase(dir)` 取快照 → `snapshotToShapes(snapshot, { idPrefix, assetBase: caseUrl(dir), mains: false })` → 顶层图形（没有 `parentId` 的）平移到它在墙上的位置 → `withoutFigmaEffects` 里用 `editor.run(…, { history: 'ignore' })` 一次 `createShapes`。不走 `putSnapshot`：它会先清空整页。
- 快照转完就丢，只留图形（`props.node` 引用快照里的节点，主组件 `mains` 和 `transforms` 会被回收）。
- 全部加载完 `editor.clearHistory()`，加载过程不进撤销记录。

### 10.5 标签层（2026-10-27，2026-10-28 修订）

类别名和用例名是一层 DOM，放在 `components.OnTheCanvas` 里（和 tldraw 一样的扩展点，`engine/react/skia-canvas.tsx` 的 `CameraLayer` 里面）：

- `CameraLayer` 的 `transform` 等于相机（页面坐标 → 屏幕坐标），订阅 `editor.on('camera')` 直接改 `style`，不触发 React 重渲染；同时在容器上设 CSS 变量 `--tl-zoom`（缩放倍数）。
- 每个标签放在页面坐标里（`left` / `top` 是板或块的左上角），`transform: scale(calc(1 / var(--tl-zoom))) translateY(-100%)` 抵消缩放，字的大小不随缩放变，贴在板的上沿。
- 类别名再往上挪一段：`min(24px, 0.2 × titleBand × 缩放)`（`--label-gap`）。整面墙缩得很小时就是块上方标题带的 1/5，和原来一样；放大到一块时最多离块 24px，刚好让开用例名，`zoomTo` 上面留的 64px 放得下，不会跑出屏幕。
- 标签最宽到板（块）在屏幕上的宽度：`--label-w` 是板的页面宽度，`max-width: calc(var(--label-w) * var(--tl-zoom) * 1px)`，超出的用省略号，完整名字放在 `title` 里。
- 什么时候显示：每个标签带 `data-min-zoom`（用例名是板在屏幕上宽 72px 时的缩放，`LABEL_MIN_PX / 板宽`；类别名是 40px，`SECTION_MIN_PX`）。`WallLabels` 订阅相机，缩放跨过阈值时才改那个标签的 `display`，平时不碰 DOM。
- 标签层不挡画布：外层 `pointer-events: none`，只有标签自己能点，点了 `zoomTo` 把相机对准那一板或那一块。在标签上滚动滚轮时把事件原样转发给画布，缩放不会卡住。
- 画布容器（`engine/react/skia-canvas.tsx` 的 `.skia-canvas`）用 `overflow: clip`，不用 `hidden`。`hidden` 的容器虽然没有滚动条，浏览器还是能滚它：焦点落到视野外的标签上（Tab 键、`scrollIntoView`）时整个容器被滚走，画布和工具栏一起上移，相机却不知道（2026-10-28 用 Playwright 点画布上的标签时发现）。`clip` 不让任何方式滚动。（2026-10-28）
- `zoomTo(editor, box)`：自己算相机，给左上角的面板、上面的标签、下面的工具栏各留出空白（`FIT_PAD`：左 292、上 64、右 32、下 88 像素；窗口窄于 720px 时左右只留 16），缩放夹在 `options.minZoom`（0.005）和 `maxZoom` 之间。

> 2026-10-27 → 2026-10-28 修订：原来写的是放在 `InFrontOfTheCanvas`、自己设 `--z`、用 `opacity: clamp(…)` 按缩放淡入淡出，实际做的时候改成了上面的样子。理由：`CameraLayer` 已经按相机变换了，放进 `OnTheCanvas` 就不用再写一遍；`opacity` 为 0 的标签还在占位置、还能挡住点击，用例名之间互相压在一起（2026-10-28 截图发现），改成按阈值切 `display`；长用例名会伸到隔壁板上，加了 `--label-w` 截断；"看全部"原来用 `zoomToBounds`，墙的左上角会被面板盖住，改成 `zoomTo` 留边。

### 10.6 按节点 id 找图层（2026-10-28）

`/demo` 上同一个 Figma 节点 id 会出现在好几个用例里（同一套稿子的几页共用组件，`copies > 1` 时整面墙也重复），原来按节点 id 找图层的 `shapesByNodeId(editor)` 每次把全部图形扫一遍建 Map。拖动开始时属性面板的"实例"一栏（`InstanceSection` → `mainOf`）要找实例的主组件，22100 个图形扫一遍约 50ms，拖动第一帧卡一下（2026-10-28 实测）。

现在 `figma/editing/instances.ts` 的 `shapeByNodeId(editor, nodeId, near?)`：

1. 有 `near`（比如实例本身）时先按它的 id 前缀拼出同一个用例里的图形 id `<前缀>:<nodeId>`，`editor.getShape` 直接取，O(1)。图形 id 是 `snapshotToShapes` 按 `<idPrefix>:<节点 id>` 生成的。
2. 拼不出来（不同前缀、图形 id 不是这种格式）再查索引 `nodeIndex(editor)`：节点 id → 图形 id 集合，每个编辑器一份（`WeakMap`）。第一次用时从 `editor.store.allRecords()` 建（不经过响应式查询，所以在别的计算里第一次调用也不会把全部图形记成依赖），之后靠 store 的创建、删除、修改副作用增量维护。
3. 索引带一个 `version` atom，只在节点 id 出现或消失时加一，改位置、改属性不加，所以用到它的计算不会每次编辑都重算。

`mainOf(editor, instance, byNode?)` 不传 `byNode` 时走 `shapeByNodeId`，属性面板换组件（`panel.tsx`）也用它，按当前图形所在的用例找。
