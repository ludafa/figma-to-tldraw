# 自研 Skia 画面引擎：验证方案

> 相关：[模块说明](README.md) · [产品设计](product.md) · [技术实现](tech.md) · [施工计划](plan.md)

## 1. 自动测试

| 测试文件                                          | 测什么                                                                                                                                                                                                                                                                                            | 日期                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `apps/client/src/figma/**/*.test.ts`（沿用）      | 转换、组件、自动布局、实例、面板操作、富文本。原来跑在 tldraw 的 `Editor` 上，阶段 7 改成跑在本引擎的 `Editor` 上，断言不改。`paint.test.ts`（CSS 渐变图）随 `paint.tsx` 删掉，渐变矩阵的断言挪到 `paint-math.test.ts`（新），加了虚线和椭圆周长                                                  | 2026-10-27             |
| `apps/client/src/engine/state.test.ts`（新）      | 信号：computed 只在依赖变了才重算、reaction 停止后不再跑、`transact` 合并通知、`isEqual`、`unsafe__withoutCapture` 不收集依赖                                                                                                                                                                     | 2026-10-27             |
| `apps/client/src/engine/store.test.ts`（新）      | store：子图形按 index 排序和换父节点、`preserve` 保留旧 props、一次 `atomic` 只发一个合并的 diff、`beforeChange` / `beforeDelete` 副作用、同一条记录在一次操作里改几次只发一次 after 回调；历史：按 mark 撤销重做、`bailToMark` 不留重做、标记不在了就什么也不动、`ignore` 模式、新改动清空重做栈 | 2026-10-27，2026-10-28 |
| `apps/client/src/engine/indices.test.ts`（新）    | 分数索引：反复夹逼仍然有序、上下方向、批量生成、`sortByIndex`                                                                                                                                                                                                                                     | 2026-10-27             |
| `apps/client/src/engine/render/svg.test.ts`（新） | SVG 解析：元素树、注释和 `<?xml?>`、实体解码、`parseColor`（十六进制、rgba、颜色名、none / url / transparent）、`parseTransform` 的组合顺序和 `matrix()`；`backdropOpacity` 取背景模糊所属图形的不透明度（tech.md §5.9，2026-10-28）                                                              | 2026-10-27             |

| `apps/client/src/engine/render/renderer.test.ts`（新） | `easeInOut` 和 CSS `ease-in-out` 一致：两端和中点、先慢后快再慢、对称、单调；脏矩形（tech.md §5.10）：整棵树先子后父删掉时盖住整个父图形，先改子图形再改父图形时父图形的旧范围还在 | 2026-10-27，2026-10-29 |
| `apps/client/src/engine/render/overlay.test.ts`（新） | `parseCssColor`：空格写法加百分比透明度、逗号写法、十六进制和颜色名交给 CanvasKit | 2026-10-27 |
| `apps/client/src/demo/layout.test.ts`（新） | `layoutWall`：每个用例放一次、尺寸不变、互不重叠；每块包住自己的板、空类别跳过；小用例换行排而不是排成一长条；`copies` 重复时 id 前缀不重复 | 2026-10-27 |
| `apps/client/src/engine/render/image-size.test.ts`（新） | `encodedImageSize` 读 PNG、JPEG、GIF、WebP 文件头，其他格式返回 null；`imageLevel` 按缩放取档、最小 256px、小图不缩；`levelsToDrop` 不到上限时一档都不丢、超过时丢最久没用的 | 2026-10-28 |
| `apps/client/src/engine/render/tiles.test.ts`（新） | `overviewCovers`：总览范围内（含一个总览像素的余量）算覆盖，伸出去的不算 | 2026-10-28 |
| `apps/client/src/figma/skia/text-shadows.test.ts`（新） | `withTextShadows`：按偏移和 3 个 sigma 扩大文字的绘制范围，隐藏的投影和别的效果不算 | 2026-10-28 |
| `apps/client/src/figma/skia/text.test.ts` | 段落按 `\n` 切、`\r` 当空格；`resolvedLineHeight`：同字体按字号放大、换了字体用那个字体的自动行高（Poppins、Roboto Mono、Noto Sans SC）、固定行高不变（tech.md §11.2）；首字母大写从词中间开始时不变大写（§11.9） | 2026-10-27，2026-10-28 |

画面本身没有单测（要 WebGL），靠 §2 的对比脚本和 §4 的交互脚本兜底。整个 client 共 27 个测试文件、145 条（2026-10-28 code review 修正后）。

## 2. 端到端检查

| 检查                                                                                      | 预期                                                               | 日期       |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------- |
| `pnpm dev:client` 后 `pnpm --filter @figma-to-tldraw/client compare`                      | 175 个用例全部小于 1%；报告在 `reports/fidelity/<时间>/index.html` | 2026-10-27 |
| `pnpm --filter @figma-to-tldraw/client exec tsx scripts/bench.ts`（阶段 9 新增）          | 4 项操作平均 ≥ 60fps，同时记最慢 5% 的帧间隔和长帧数               | 2026-10-27 |
| `pnpm --filter @figma-to-tldraw/client exec tsx scripts/font-metrics.ts`                  | 重新生成的 `font-metrics.json` 和提交的一样                        | 2026-10-27 |
| `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm --filter @figma-to-tldraw/client build` | 全部通过                                                           | 2026-10-27 |

性能基准怎么测：

- 浏览器：Playwright 起有界面的 Chromium（用真实 GPU；无头模式的 WebGL 是软件渲染，不代表用户机器），窗口 1440 × 900，设备像素比 2。
- 用例：`real/golio---free-landing-page-ui-kit-design` 最大的一页（1468 个节点）和 Untitled UI 节点最多的一页。
- 每项操作 2 秒：平移是每帧移动 20px 的连续拖动；缩放是以视野中心为点、每帧 ±2% 来回缩放；自由拖动拖一个顶层卡片；自动布局排序拖一个列表项上下穿过兄弟节点。
- 页面里用 `requestAnimationFrame` 记录每帧时间戳，脚本读回来算平均帧率、最慢的 5%、最长一帧，以及长帧数（间隔超过两个 60Hz 帧，即 33.3ms，说明至少掉了一帧）。`cpu` 是控制器每帧在 JS 里花的时间（`stats.lastFrameMs`），不含 GPU。
- 可以在命令行后面跟用例目录换用例。某个用例里没有这类图层（比如 `page/mobile-login` 全是自动布局，没有自由布局的图层可拖）就打印"跳过"，不算未达标。
- 本机（Apple Silicon，显示器 240Hz）`requestAnimationFrame` 最高 240 次每秒，所以空闲时也是 240fps 左右。
- 目标后面跟的也可以是页面路径：`/demo`、`/demo?copies=2` 测整面墙；`/demo@<用例目录>` 先等整面墙 ready，再把相机对准这个用例（按 id 前缀找它的顶层图形）、等 `whenIdle()`，然后在这个用例上测。整面墙上拖动时只挑屏幕上宽度超过 24px 的图层；没有可拖的自由布局图层时拖一整块板。（2026-10-28）
- 达标线按显示器刷新率定：脚本先空跑 1 秒量出刷新率，达标线 = min(60, 刷新率) − 0.5fps。2026-10-28 起本机显示器是 60Hz（原来是 240Hz），60fps 就是满帧，所以留 0.5 的余量；最后打印"全部达标"或"未达标 N 项"。（2026-10-28）

## 3. 手动验收清单

1. `/canvas?case=fill/linear-gradient` → 画面是一张 `<canvas>`，打开"差异"叠加模式，几乎全黑。
2. 在画布上按住空格拖动、Ctrl / ⌘ + 滚轮缩放 → 画面跟手，没有空白块闪烁超过一两帧。
3. 点一个卡片 → 出现蓝色选框和 4 个角上的控制点；拖动 → 跟手，松开后 ⌘Z 回到原位。在空白处拖出框选 → 半透明的蓝色矩形，不是一整块黑。
4. 在自动布局的列表里拖一项 → 经过兄弟节点时实时交换位置，被越过的兄弟约 0.15 秒滑过去，被拖的一项一直压在最上面；松手落进空位，⌘Z 一次恢复。
5. 双击一段文字 → 出现编辑框，改字后点空白处，画面上的字跟着变。
6. `/canvas?case=…&shot=1` → 没有界面，只有画面，左上角留 40px 白边。
7. `/showcase` 顶上点"全部用例一张画布 →" → 进 `/demo`，左上角面板的用例数从 0 涨到 175 / 175，图形 22,100；加载过程中能拖动、缩放。（2026-10-28）
8. `/demo` 点面板里的"填充" → 相机对准这一块，块上方有类别名"填充"，每个用例上方有用例名，都不压在一起，也不被面板挡住；长用例名截断成"…"。点"看全部"回到整面墙。（2026-10-28）
9. `/demo` 在任一用例上单击、拖动 → 和 `/canvas` 一样能选中、拖动、⌘Z 撤销。（2026-10-28）
10. `/demo?copies=2` → 图形 44,200，面板写着 "175 / 175 × 2"。（2026-10-28）
11. `/canvas` 按 T（文字工具）在空白处点一下 → 直接出现编辑框；打字后按 Esc，字留下、回到选择工具，⌘Z 一次删掉这段字。用文字工具拖出一个框、或者点到已有的文字，也直接进编辑。（2026-10-28）
12. `/canvas` 选一段文字，右侧"效果"里加一个投影 → 字下面出现投影，改偏移和模糊跟着变。（2026-10-28）
13. `/canvas?case=page/gallery`，在左边列表里点 `fill/solid` → 画布上只有 solid 那个白底蓝块，gallery 的深色背景和卡片一点不剩；再点 `page/mobile-login`、`radius/uniform` 来回切，也没有残留。（2026-10-29）

## 4. 各次实际结果

### 2026-10-27

在 Node 26 里用 `canvaskit-wasm` 0.41.1 做的实验（实测，脚本在会话的临时目录，没有进仓库）：

- `Typeface.MakeTypefaceFromData` 能直接读 woff 和 woff2（Google Sans Flex、Inter 都试过）。
- 把 Inter 的拉丁子集注册成别名 `A`、Noto Sans SC 的 100 多个子集注册成 `B0`…，段落样式 `fontFamilies: ['A', 'B0', …]`，"Hello 你好 world" 没有找不到字形的字（`unresolvedCodepoints()` 为空）。
- `LineMetrics`：`width` 不含行尾空格（"Hello " 的 `endExcludingWhitespaces` 是 5，宽 38.30；`getMaxIntrinsicWidth()` 含空格是 51.79）。
- U+2028 和 `\n` 都被当成强制换行；长单词超宽时按字符断开。
- 16px Inter 的 "Hello" 加 2px 字间距：`getRectsForRange` 从 x = 1 到 49.30，即每个字前后各加 1px（tech.md §7.2 第 5 条）。
- `Font.getMetrics()`：16px Inter 上沿 −15.5、下沿 3.86，`underlinePosition` 2.636 = 464 / 2816 × 16，`strikeoutPosition` −5.239 = −922 / 2816 × 16，和 tldraw 版记的字体数值一致。

字体指标（`scripts/font-metrics.ts`，实测）：17 个字体族，同一族各字重的指标都一样。typo 和 hhea 不同的有 Noto Sans SC（880 / 120 对 1160 / 288，UPM 1000）、Lato（1610 / 390 对 1974 / 426，UPM 2000）、Zilla Slab（787 / 213 对 944 / 256）。

`tsc -p apps/client/tsconfig.app.json` 对 `src/engine/` 和 `src/figma/skia/` 没有报错（`figma/skia/text.ts` 刚写完，还没检查）。

还原度（`scripts/compare.ts`，Playwright 截 2 倍图 + pixelmatch，实测）：

| 报告 `reports/fidelity/…` | 做了什么之后                                       | 平均差异            | < 1% 的用例       | 最差                                                                   |
| ------------------------- | -------------------------------------------------- | ------------------- | ----------------- | ---------------------------------------------------------------------- |
| `20261027-213537`         | 第一次全量                                         | 7.00%               | 144 / 175         | untitled-ui 的 dashboards、`blend/modes`，90% 以上（混合模式整块变黑） |
| `20261027-214327`         | GL 上下文带 alpha（只重跑失败的 31 个）            | —                   | 18 / 31 变成 < 1% | Lato 的稿子 1.09%～2.65%                                               |
| `20261027-214727`         | Lato、Zilla Slab 用 hhea 上下沿（重跑 33 个）      | —                   | 32 / 33           | `designs-48` 1.40%                                                     |
| `20261027-215446`         | 混合字号的行距、覆盖行高、百分比字间距             | 0.17%               | 175 / 175         | `dark-page-desktop` 0.94%                                              |
| `20261027-220309`         | 背景模糊两层 `saveLayer`（重跑 38 个带背景模糊的） | —                   | 38 / 38           | `dark-page-desktop` 0.71%                                              |
| `20261027-222657`         | 收尾全量重跑（删掉 tldraw、加了拖动动画之后）      | **0.17%**（0.168%） | **175 / 175**     | `designs-30` 0.93%                                                     |

收尾那次 48 个用例逐像素一致；最差的几个是 `designs-30` 0.93%、`image-filter/exposure` 0.74%、`dark-page-desktop` 0.71%、`image-filter/shadows` 0.70%。和 `20261027-215446` 比，没有一个用例变差超过 0.001 个百分点，7 个变好超过 0.01（`dark-page-desktop` 0.94% → 0.71%、`effect/background-blur` 0.04% → 0%，都是背景模糊那次修复）。

性能基准（`scripts/bench.ts`，有界面的 Chromium，1440 × 900，设备像素比 2，每项 2 秒，实测）：

| 用例                                                                      | 平移             | 缩放                          | 自由拖动                   | 自动布局拖动排序      |
| ------------------------------------------------------------------------- | ---------------- | ----------------------------- | -------------------------- | --------------------- |
| golio `pre-made-templates-digital-agency-landing-page`（快照 62MB，最大） | 239.9fps，长帧 0 | 221.5fps，长帧 2，最长 87.5ms | 237.5fps，长帧 0           | 236.5fps，长帧 1      |
| golio `pre-made-templates-consulting-company-website`                     | 240.0fps，长帧 0 | 238.5fps，最长 16.6ms         | 236.5fps，最长 33.4ms      | 236.5fps，最长 33.3ms |
| Untitled UI `dashboards-desktop-3`                                        | 239.0fps，长帧 0 | 225.5fps，长帧 1，最长 100ms  | 234.5fps，长帧 1           | 224.0fps，长帧 1      |
| Untitled UI `dashboards-desktop-2`                                        | 240.0fps，长帧 0 | 231.9fps，长帧 0              | 234.5fps，长帧 1           | 229.5fps，长帧 1      |
| `page/mobile-login`                                                       | 240.0fps，长帧 0 | 239.5fps，长帧 0              | 跳过（没有自由布局的图层） | 236.0fps，长帧 0      |

- 4 项操作在所有用例上平均帧率都在 220fps 以上，远高于 60fps 的要求；最慢 5% 的帧间隔都在 4.6ms 左右。每帧 JS 时间 0.3～1.6ms。
- 长帧每 2 秒最多 2 个，都出在操作刚开始：缩放时第一次换到新的缩放级别，要按新比例重画一批瓦片（实测第一帧画 10 块瓦片用了 34ms）；拖动时第一下要进入拖动状态、记下拖动前的快照。之后每帧都在预算内。同一用例跑几次，最长那一帧在 29～250ms 之间浮动（`dashboards-desktop-2` 的缩放有一次 249.9ms，另一次最长 33.3ms），平均帧率不受影响。
- 加上拖动时的抬起和滑动（tech.md §5.8）以后重跑：`page/mobile-login` 自动布局拖动 237.0fps，长帧 0；`dashboards-desktop-3` 自由拖动 235.0fps、自动布局拖动 231.5fps，各 1 个长帧。

交互脚本（Playwright，会话临时目录里的脚本，实测）：

- `text/paragraphs`：单击选中、双击进入文字编辑（`select.editing_shape`）、打字改到 `characters`、Esc 退出；D 画笔画出 21 个点，A 拖出箭头后回到选择工具，⌘Z 撤销掉箭头；Ctrl+滚轮以鼠标为中心缩放，滚轮平移。
- `layout/horizontal`：⌘A、⌘D（8 → 16 个图形）、⌘Z / ⌘⇧Z、选中后 Backspace 删除、⌘C / ⌘V、⌘= / ⌘- / ⇧0 / ⇧1、按住空格拖动平移 100 × 50px、H 换抓手；框选选中 3 个。发现并修了框选矩形整块变黑（tech.md §5.6）。
- `page/mobile-login`：Sign in 按钮往上拖，依次和 "Options"、密码输入框交换，被越过的图层 150ms 滑过去（tech.md §5.8）；松手后 ⌘Z 一次恢复。修了抬起时父级链把页面也当成图形、整帧抛错的问题。
- `/showcase` 用例详情、`/how-it-works` 节点树演示的画布都正常，没有报错。`/import` 导入 5 个用例的 zip（`fill/solid`、`blend/modes`、`text/paragraphs`、`effect/background-blur`、`image/fill`）：0% / 0.16% / 0.25% / 0% / 0%，和对比脚本一致。

### 2026-10-28

总览 Demo 页 `/demo` 和为它做的引擎修改（plan.md 2026-10-27～10-28 的修复记录 1～9）。本机 Apple Silicon，显示器 60Hz，Chromium（Playwright），窗口 1440 × 900，设备像素比 2。

- `pnpm test`：23 个测试文件、133 条全部通过（新增 `image-size.test.ts` 7 条、`layout.test.ts` 4 条）。
- 加载（实测，有界面的 Chromium）：

  | 页面             | 图形   | 到 `__figmaReady` | CanvasKit wasm 堆 | 图片                     |
  | ---------------- | ------ | ----------------- | ----------------- | ------------------------ |
  | `/demo`          | 22,100 | 11～13 秒         | 161～193MB        | 682 个地址，全部加载完   |
  | `/demo?copies=2` | 44,200 | 17 秒             | 161MB             | 同上（第二份不重复下载） |

  修之前：加载到一半 wasm 堆涨满 2GB 崩溃（修复记录 1、2）；去掉崩溃以后 `__figmaReady` 两分钟不变 true（修复记录 3）。

- 还原度（`scripts/compare.ts` 全量，`reports/fidelity/20261028-001008`，3 个超时的用例修了以后在 `20261028-001828` 重跑）：**175 / 175 小于 1%，平均 0.155%**（上次 `20261027-222657` 是 0.168%），48 个逐像素一致，最差 `designs-30` 0.92%。变好的主要是图片滤镜：`image-filter/exposure` 0.74% → 0.36%、`combined` 0.68% → 0.33%，另外 4 个各少 0.2 个百分点左右（浏览器解码的图片和 Skia 解码的有细微差别，正好更接近 Figma）。变差最多的是 `page/product-list` +0.013、`dashboards-desktop-2` +0.009 个百分点。改了画布容器的 `overflow` 以后抽 28 个用例重跑（`20261028-002833`），和改之前完全一样。
- 性能基准（`scripts/bench.ts`，每项 2 秒，达标线 59.4～59.5fps）：

  | 目标                                                    | 平移            | 缩放                 | 自由拖动                      | 自动布局拖动排序 |
  | ------------------------------------------------------- | --------------- | -------------------- | ----------------------------- | ---------------- |
  | `/demo`（整面墙）                                       | 60.0fps，长帧 0 | 60.0fps，长帧 0      | 60.0fps，长帧 0               | 60.0fps，长帧 0  |
  | `/demo@…/dashboards-desktop-2`（放大到一个用例）        | 60.1fps         | 59.9fps              | 60.0fps                       | 60.0fps          |
  | `/demo@…/pre-made-templates-consulting-company-website` | 60.0fps         | 59.9fps              | 60.0fps                       | 59.5fps          |
  | `/demo?copies=2`（整面墙，第一次）                      | 60.0fps         | 59.5fps，最长 33.3ms | 57.1fps，长帧 1，最长 116.7ms | 59.5fps          |
  | `/demo?copies=2`（整面墙，第二次）                      | 60.0fps         | 59.5fps，长帧 1      | 59.5fps，最长 33.3ms          | 60.0fps          |
  | `/demo?copies=2@…/dashboards-desktop-2`                 | 60.1fps         | 60.0fps              | 59.0fps，长帧 1，最长 50ms    | 59.5fps          |
  - `/demo`（2 万多个图形，产品要求的场景）4 项全部达标。
  - `?copies=2`（4 万多个图形，压力测试）平移和自动布局拖动达标，缩放正好压线，自由拖动在拖动开始那一下有一个长帧。用 CPU 采样看，这一下约 31ms：第一次命中测试要算全部 44200 个图形的子树范围（`editor.getSubtreeLocalBounds`，约 16ms，算完就缓存，平时鼠标移进画布悬停时就算掉了，基准脚本是直接按下）；选中后属性面板的 React 渲染约 10ms（开发模式）。116.7ms 那次没有复现，算偶发（多半是垃圾回收）。没有为它改代码，记在这里。
  - 修之前（同一台机器）：整面墙缩放 20fps（图片原尺寸上传纹理），加了图片分级后 46fps，再加瓦片分片补画后 60fps；拖动开始卡 50ms（按节点 id 扫全部图形），改成索引后不卡。

- 截图检查（会话临时目录 `scratchpad/shots/`）：整面墙（面板不挡墙、类别名不重叠）、放大到"填充"（类别名和 9 个用例名都在）、放大到"Golio 落地页"（长用例名截断成"…"）。
- 没做：Safari、Firefox 上没测（`createImageBitmap` 的缩小解码参数各浏览器支持不同，tech.md §9）；生产构建下的帧率没测（上面都是 `pnpm dev`）。
- SVG 背景模糊的不透明度（tech.md §5.9，`/import` 回归检查时发现）：Free Banking（不在 175 个用例里，用的是商业字体）在 `/compare` 里 All Cards 8.25% → 0.44%、Home 0.47% → 0.30%，History 0.19%、Statistics 0.10%、Onboarding-2 0.24% 不变。175 个用例里 7 个 SVG 背景模糊的图形都没有 `opacity`，走的还是原来的代码，没有重跑全量对比。

### 2026-10-28（code review 修正）

plan.md "2026-10-28（code review 修正）"那一节的改动。本机同上。

- `pnpm lint`、`pnpm typecheck` 通过；`pnpm test` 27 个测试文件、145 条全部通过（新增 `store.test.ts` 1 条、`tiles.test.ts` 2 条、`text-shadows.test.ts` 2 条）。
- Playwright 交互脚本（`/canvas`，有界面的 Chromium）：文字工具点一下新建、拖出框新建、点到已有文字，三种都进 `select.editing_shape`；打字后 Esc 回到 `select.idle`、字留下；撤销一次删掉、重做回来；给文字加红色投影（偏移 0, 12）后，导出这块区域，红色像素从 0 变成 111。页面错误 0 个。
- `/demo` 加载到 `__figmaReady` 8.9 秒，页面错误 0 个。
- `/import` 回归（手动验收第 38～42 条的脚本，tldraw 版 verification.md）：全部通过，E-Learning 4 个画板 0.01%，Free Banking 显示商业字体提醒，`/compare` 能看到同一批导入。`/compare` 导入 Free Banking：All Cards 0.44%、History 0.19%、Home 0.30%、Statistics 0.10%、Onboarding-2 0.24%，和改之前一样。
- 没测：总览扩大（§5.5）只有单测，没在页面上专门构造"往总览外加图形"的场景看；两个画布同时在一个页面上的键盘分配（§6.5）没有现成的页面，没实测。

### 2026-10-28～10-29（混合样式文字）

plan.md "2026-10-28（分支 `feat/mixed-text`，混合样式文字）"那一节的改动。本机同上，对比脚本连 `CANVAS_URL=http://localhost:5199`。

- `pnpm lint`、`pnpm typecheck` 通过；`pnpm test` 27 个测试文件、149 条全部通过（`skia/text.test.ts` 新增 4 条：`resolvedLineHeight` 3 条、首字母大写 1 条）。
- 基线（改之前）：`text-mixed/*` 19 个平均 1.42%，12 / 19 小于 1%（`reports/fidelity/20261028-224211`）。
- 全量对比（`reports/fidelity/20261029-090108`）：194 / 194 小于 1%，平均 0.090%，最大 0.83%（`designs-30`）。和上一次全量（`20261028-001008`，175 个）比：变好 109，变差 0，不变 66。其中 3 个（`settings-pages-desktop-2`、`settings-pages-desktop-4`、`design-product-detail-2`）上次是没画出来的 100%，这次 0.01%～0.11%。
- `text-mixed/*` 19 个平均 0.075%，各用例：

  | 用例                | 差异  | 用例                 | 差异  |
  | ------------------- | ----- | -------------------- | ----- |
  | `align`             | 0.03% | `letter-spacing`     | 0.21% |
  | `case`              | 0.02% | `line-height-fixed`  | 0.08% |
  | `cjk-latin`         | 0.12% | `line-height-runs`   | 0.07% |
  | `colors`            | 0.03% | `lists`              | 0.08% |
  | `decoration-styles` | 0.08% | `paragraphs`         | 0.11% |
  | `decorations`       | 0.05% | `size-last-line`     | 0.06% |
  | `fonts`             | 0.07% | `size-multi-in-line` | 0.05% |
  | `gradients`         | 0.08% | `size-small-in-big`  | 0.09% |
  | `stroke-shadow`     | 0.04% | `truncation`         | 0.11% |
  | `weights`           | 0.05% |                      |       |

- 文字类老用例因为基线取整（tech.md §11.11）明显变好：`text/wrap` 0.44% → 0.10%，`text/line-height` 0.37% → 0.07%，`text/decoration-case` 0.18% → 0.00%，`text/align-horizontal` 0.13% → 0.01%。
- 全量跑完后，波浪线的线宽从 t 改成 2t/3，只重跑了 `decoration-styles`（0.08%），没再跑全量。只有带波浪线的文字受影响，老用例里没有。
- 之后（2026-10-29）computer use 能用了：在 Figma 里生成并导入 3 个装饰线用例（共 197 个），改了跳过下伸部分的挖法和波浪线圆头（tech.md §11.10）。第二次全量对比（`reports/fidelity/20261029-091947`）：197 / 197 小于 1%，平均 0.091%，最大 0.83%；`text-mixed/*` 22 个平均 0.083%，最大 0.21%（`letter-spacing`）；新用例 `decoration-wavy` 0.17%、`decoration-dotted` 0.04%、`decoration-units` 0.19%；和第一次全量比变好 1、变差 2（+0.005%、+0.007%）、不变 191。
- 装饰线逐条量过（2 倍图）：点线、波浪线 12 / 22 / 40px 和 1 / 3 / 6px 粗的波长、摆幅、墨量、点距、点大小和 Figma 差 ≤ 0.25px；`PERCENT` 粗细和偏移逐像素一样；跳过下伸部分 12 个空隙的边缘每条差 ≤ 3 像素。
- 没做：`SMALL_CAPS`、`SMALL_CAPS_FORCED` 在 Figma 里对 Inter、Lato 都设不上，没测到；很粗的波浪线在跳过下伸部分时的断口形状（Figma 是圆头、断得更早）没对上。

### 2026-10-29（切用例残留，用户试用发现）

plan.md "2026-10-29（分支 `feat/figma-variables`，切用例残留）"那一节的改动。

- `pnpm lint`、`pnpm typecheck` 通过；`pnpm test` 29 个测试文件、201 条全部通过（`renderer.test.ts` 新增 2 条，临时去掉 `stalePageBounds` 的回退时这 2 条失败）。
- Playwright（无头 Chromium，1280 × 900，设备像素比 2）：先直接打开目标用例截画布，再打开来源用例、点左边列表切过去再截，逐像素比（每个像素 RGB 差的和超过 30 算不同）：

| 切换                                                                | 修之前             | 修之后 |
| ------------------------------------------------------------------- | ------------------ | ------ |
| `page/gallery` → `fill/solid`                                       | 517,748 个像素不同 | 0      |
| `page/mobile-login` → `radius/uniform`                              | 59,997             | 0      |
| `page/product-list` → `page/mobile-login`                           | 0                  | 0      |
| E-Learning `visual-high-fidelity-detail` → `page/mobile-login`      | 没测               | 0      |
| `layout/wrap` → `fill/solid`、`fill/solid` → `fill/linear-gradient` | 0                  | 没重测 |

- 手动验收第 13 条按上面的脚本跑过，页面错误 0 个。没在 `/demo` 和编辑时"自动布局 frame 跟着内容缩小"的场景专门看，后者是同一处漏标，只有单测。

### 2026-10-29（差异叠加，用户试用发现）

plan.md 同一天"阶段 2"的改动。

- Playwright（无头 Chromium，1440 × 1000）：`/canvas?case=real/untitled-ui-free-figma-ui-kit-and-design/settings-pages-desktop-2`，取画布上 (60, 120)～(900, 900) 这块，近黑（RGB 最大值 < 40）的像素占比：不叠加 0.3%、半透明 0.3%、差异 99.7%；滚轮平移后 98.4%，Ctrl+滚轮放大后 99.1%（文字边缘有一圈抗锯齿的亮线）。修之前"差异"显示的是 Figma 原图本身（用户截图）。
- `/import`（1100 × 900）：导入 `tmp/figma-test-cases-20261029-1041.zip`，"差异"时用例那块变黑；悬停差异分析的第一项，红色高亮框盖在 "Colors, text and visibility…" 那行字上（339 个红色像素）。页面错误 0 个。
- 900px 宽窗口：工具条 644px 宽，用例名截断成 "settings-pages-d…"，三个按钮都是一行（高 24px）。
- 手动验收第 1 条（差异几乎全黑）现在成立。
