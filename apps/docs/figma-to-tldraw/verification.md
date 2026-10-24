# Figma 还原到 tldraw：验证方案

> 相关：[模块说明](README.md) · [技术实现](tech.md) · 施工计划 [`docs/施工计划.md`](../../../docs/施工计划.md)

## 1. 自动测试

| 测试文件                                         | 测什么                                                                                                                                                                                                                                 | 日期       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `apps/client/src/figma/to-shapes.test.ts`        | 节点树拆成图形：根节点放原点、子节点相对父节点、旋转节点用 `transforms`、隐藏节点跳过、兄弟顺序、不认识的类型给警告、矢量按渲染范围摆放和蒙版、画不出东西的矢量直接跳过、First on top 倒过来排、带滤镜的图片用渲染好的图（缺图给警告） | 2026-10-24 |
| `apps/client/src/figma/paint.test.ts`            | 文字渐变用的 SVG 渐变图：尺寸等于文字框、变换矩阵按渐变手柄算、颜色正确；角度渐变不生成                                                                                                                                                | 2026-10-24 |
| `apps/client/src/figma/image-filters.test.ts`    | 带滤镜图片的 key：只列不为 0 的滤镜、固定顺序、保留 3 位小数；没有滤镜时不生成                                                                                                                                                         | 2026-10-24 |
| `apps/client/src/figma/fonts.test.ts`            | 字体代替：Product Sans 后面紧跟 Google Sans Flex 和字宽设置，判断缺字体时只看第一个字体；别的字体不受影响                                                                                                                              | 2026-10-24 |
| `apps/client/src/figma/diff-attribution.test.ts` | 差异归因：红色像素算给盖在最上面的节点，按种类汇总、按像素数排序，文字节点带内容和字体；裁剪框外的部分不算给子节点；First on top 倒过来排；半透明遮罩、只有描边的框、不画东西的容器不抢下面的像素                                      | 2026-10-24 |
| `apps/client/src/figma/geometry.test.ts`         | 圆角矩形拆成四条边和四个角（虚线按段排用），段长正确；没有圆角时不出现长度为 0 的角                                                                                                                                                    | 2026-10-24 |

命令：`pnpm --filter @figma-to-tldraw/client test`。

## 2. 端到端检查

| 检查                                                        | 预期                                                                                                  | 日期       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------- |
| `pnpm dev` 后打开 `http://localhost:5173/canvas`            | 左侧是用例列表，画布上是示例 frame                                                                    | 2026-10-24 |
| `curl localhost:5173/cases/index.json`                      | 200，返回用例列表                                                                                     | 2026-10-24 |
| `pnpm --filter @figma-to-tldraw/client compare`             | 跑完全部用例，在 `reports/fidelity/<时间>/` 生成报告，`latest` 指向它                                 | 2026-10-24 |
| `pnpm --filter @figma-to-tldraw/client import-cases <zip>…` | 打印每个 zip 导入了哪些用例，`cases/index.json` 里原来的用例还在                                      | 2026-10-24 |
| `curl localhost:5173/reports/fidelity/latest/results.json`  | 200，返回最近一次对比结果（每个用例带 `breakdown`）；`/reports/fidelity/latest/` 这种文件夹地址是 404 | 2026-10-24 |
| `pnpm lint`、`pnpm typecheck`、`pnpm test`                  | 都通过                                                                                                | 2026-10-24 |

## 3. 手动验收清单

1. 打开 `/canvas?case=fill/solid` → 画布上是一个白色 frame 和一个蓝色矩形；点工具条上的"差异" → frame 区域全黑。
2. 在左侧列表点任意用例 → 网址里的 `case` 跟着变，刷新后还是这个用例。
3. 打开 `/canvas?case=page/mobile-login` → 登录页完整显示，中文和英文字体正确。
4. 在画布上点一个子图形 → 只选中这一个；拖动根 frame → 子图形跟着动。
5. 打开 `/canvas?case=不存在` → 工具条显示 1 条警告（读取失败 404），页面不崩。
6. 打开 `reports/fidelity/latest/index.html` → 顶部有用例数、平均差异、小于 1% 的个数；表格按差异从大到小排，每行三张图。
7. 打开 `/canvas?case=real/google-gemini---built-with-material-3-de/gemini-plugin-file-cover` → 工具条只有 1 条警告："缺字体：Product Sans 400（用 Google Sans Flex 近似代替）"；"Hello, Team" 里的 a 是双层的。
8. 打开 `/canvas?case=real/untitled-ui-free-figma-ui-kit-and-design/settings-pages-desktop` → 截图模式（加 `&shot=1`）下整页都在画面里，包括超出 960 高的部分。
9. 打开 `/canvas?case=image-filter/combined` → 下面那块色卡变暗、变暖、对比更强，和 `cases/image-filter/combined/expected@2x.png` 一样，工具条没有警告。
10. 打开 `/showcase` → 顶部四个数字和最新报告一致（118、0.07%、118、47）；卡片按分组排，切到"按差异从大到小"后第一张是 `gemini-macbook-pro-14---extension-screen`（0.97%）。
11. 点开任意卡片 → 四格依次是 Figma 截图、tldraw 画布、差异图、差异分析，三张图大小一样、内容位置对得上；在画布上拖动会平移，点"复位"回到原位；按 → / ← 切换用例，Esc 回列表。
12. 打开 `/showcase?case=real/google-gemini---built-with-material-3-de/gemini-macbook-pro-14---extension-screen` → "在 Figma 里打开"跳到用户草稿里的这一页，"社区原稿"跳到社区页面；差异分析写"最多的是文字，占 73%"；鼠标移到第一行「Turn Gemini Extension on or off anytime」上，差异图里这行标题被蓝框框住。
13. 打开 `/how-it-works`（或在 `/showcase` 点"核心思路"）→ 开头四个数字和 `/showcase` 一样；第 2 节点左边的 "Primary button"，右边画布上的 Sign in 按钮被选中；在画布上点 "Forgot password?"，左边这一行高亮；第 4 节三张图都显示出来。

## 4. 各次实际结果

### 2026-10-24

- 第 1 步：`hello.json` 示例在 Chrome 里按 Figma 样式显示；真实鼠标点击只选中矩形，拖动 frame 子图形跟着动；6 条单测通过。
- 第 2 步：用 agent-browser 在 Chrome 里打开 10 个用例（fill/angular-gradient、image/crop、mask/ellipse-image、mask/star-gradient、text/mixed-styles、boolean/union、page/gallery、component/instances、layout/wrap、effect/drop-shadow），都能显示，没有报错和警告。
- 第 3 步：第一份还原度报告 `reports/fidelity/20261024-202524/`，79 个用例跑完用时约 54 秒（4 个页面并行）。**平均差异 0.53%，73 / 79 个小于 1%**，34 个是 0.00%。差异最大的前 10 名：

| 排名 | 用例                    | 差异   | 看到的问题                                         |
| ---- | ----------------------- | ------ | -------------------------------------------------- |
| 1    | container/group-opacity | 15.53% | 组透明度被分别乘到每个子图形上，重叠的地方颜色不对 |
| 2    | effect/background-blur  | 5.62%  | 背景模糊完全没生效                                 |
| 3    | page/gallery            | 2.40%  | 图片里的细网格线有偏差，图片缩放或摆放的细节不一样 |
| 4    | text/mixed-styles       | 2.36%  | 文字                                               |
| 5    | text/decoration-case    | 1.84%  | 文字（下划线、删除线、大小写）                     |
| 6    | text/wrap               | 1.68%  | 文字换行                                           |
| 7    | text/fixed-overflow     | 0.87%  | 文字                                               |
| 8    | stroke/dashed           | 0.84%  | 虚线                                               |
| 9    | layout/vertical-fill    | 0.68%  | 文字为主                                           |
| 10   | layout/wrap             | 0.64%  | 文字为主                                           |

第 4 步的修复记录（每行是改完以后重跑受影响的用例）：

| 修了什么                                                         | 用例                    | 修之前 | 修之后 |
| ---------------------------------------------------------------- | ----------------------- | ------ | ------ |
| 矢量图形的透明度乘了两次（SVG 里已经带了），见 tech.md §4.1      | container/group-opacity | 15.53% | 2.64%  |
| 背景模糊层放到裁剪包装层外面，见 tech.md §6.3                    | effect/background-blur  | 5.62%  | 0.01%  |
| Inter 换回 3.19 版本，斜体用倾斜 10° 的可变字体，见 tech.md §6.4 | text/single-line        | 0.56%  | 0.00%  |
|                                                                  | text/letter-spacing     | 0.56%  | 0.01%  |
|                                                                  | text/wrap               | 1.68%  | 0.95%  |
|                                                                  | text/decoration-case    | 1.84%  | 1.36%  |
|                                                                  | text/mixed-styles       | 2.36%  | 2.15%  |
|                                                                  | text/truncation         | 0.54%  | 0.11%  |
|                                                                  | text/line-height        | 0.44%  | 0.13%  |
|                                                                  | page/mobile-login       | 0.32%  | 0.26%  |
| 自动行高用无单位倍数，大字能撑高所在的行                         | text/mixed-styles       | 2.15%  | 0.75%  |
| 下划线、删除线用字体自带的粗细和位置                             | text/decoration-case    | 1.36%  | 1.29%  |
| 按 Chrome 和 Figma 的基线取整规则补 -1～1px（tech.md §6.4）      | text/decoration-case    | 1.29%  | 0.19%  |
|                                                                  | text/align-horizontal   | 0.23%  | 0.00%  |
|                                                                  | layout/wrap             | 0.61%  | 0.06%  |
|                                                                  | layout/absolute-child   | 0.36%  | 0.01%  |
|                                                                  | page/mobile-login       | 0.26%  | 0.02%  |
|                                                                  | page/product-list       | 0.34%  | 0.13%  |
|                                                                  | component/instances     | 0.06%  | 0.00%  |
|                                                                  | container/clip-on       | 0.17%  | 0.01%  |
| 截图时抵消 tldraw 画布层的 0.125px 偏移（tech.md §7）            | page/gallery            | 2.02%  | 1.03%  |

全量重跑（`reports/fidelity/20261024-205207/`）：**平均差异 0.53% → 0.10%，小于 1% 的 73 → 77 / 79**。还剩两个超过 1%：`container/group-opacity` 2.64%（组透明度，需要架构改动，见 tech.md §4.1）、`page/gallery` 1.03%。

改用真实 2 倍屏截图（tech.md §7），基线公式加上屏幕倍数（tech.md §6.4）后全量重跑（`reports/fidelity/20261024-205614/`）：**平均差异 0.09%，小于 1% 的 78 / 79**；`page/gallery` 1.03% → 0.07%，`text/mixed-styles` 0.86% → 0.55%。全部单行文字里，顶部位置和 Figma 一样的占绝大多数（量法见下面的说明）。

量文字上下偏移的办法：在每个文字节点的框里分别找 Figma 图和截图里第一行、最后一行有字的像素行，两边相减。脚本是临时写的，没有放进仓库。

| 修了什么                                                                             | 用例                    | 修之前 | 修之后 |
| ------------------------------------------------------------------------------------ | ----------------------- | ------ | ------ |
| 重置 tldraw 继承下来的圆头线帽，描边按 `strokeCap` / `strokeJoin` 设（tech.md §6.2） | stroke/cap-join         | 0.18%  | 0.00%  |
| 矩形虚线按段排，每段整数个周期、从半个实线开始（tech.md §6.2）                       | stroke/dashed           | 0.93%  | 0.00%  |
| 自动行高四舍五入到整像素，每段按自己的字号算（tech.md §6.4）                         | text/wrap               | 0.93%  | 0.02%  |
|                                                                                      | text/fixed-overflow     | 0.47%  | 0.01%  |
|                                                                                      | text/paragraphs         | 0.23%  | 0.01%  |
|                                                                                      | text/truncation         | 0.15%  | 0.03%  |
| 基线补偿按字体分别用 Figma（typo）和 Chrome（hhea）的高度数据（tech.md §6.4）        | text/cjk-mixed          | 0.40%  | 0.00%  |
|                                                                                      | page/mobile-login       | 0.09%  | 0.00%  |
| 下划线往下补半个线粗，删除线改用背景按 Figma 的位置画（tech.md §6.4）                | text/decoration-case    | 0.23%  | 0.00%  |
| 透明的组里，把被上层不透明兄弟盖住的部分从下层裁掉（tech.md §4.1）                   | container/group-opacity | 2.66%  | 0.00%  |

| 比基础行高大的文字只把行往上撑，不往下撑（tech.md §6.4） | text/mixed-styles | 0.57% | 0.00% |

最后一次全量重跑（`reports/fidelity/20261024-211751/`）：**平均差异 0.004%，79 / 79 个小于 1%，65 个是 0.00%**，没有出错和警告。剩下差异最大的几个都不到 0.1%：

- `page/gallery` 0.07%：FIT 和 TILE 两张图片里面的内容差半个像素左右，像是图片缩放取样不一样；其余是文字边缘的抗锯齿。
- `blend/modes` 0.04%：multiply 圆下面的文字边缘。
- `text/truncation` 0.03%：省略号截断的位置不一样。Figma 可以截在单词中间（"onto s…"），Chrome 多行截断只截在单词之间（"onto …"）。

这些都属于目标里说的"1% 以下的细微差异"，没有继续追。

第 5 步：用 Figma 社区的两份稿子导出 31 个整页，不改渲染规则跑全部 110 个用例（`reports/fidelity/20261024-215318/`，用时 1 分 45 秒）。原来 79 个不变（平均 0.004%），31 个新用例平均 1.91%、25 个小于 1%。详细结果和问题归类见 §6。导出时遇到 136 个 SVG 导出失败，查下来都是被裁掉、画不出东西的图标，插件改成跳过（tech.md §9.1）。

### 2026-10-24（展示页，用户追加）

- `pnpm lint`、`pnpm typecheck` 通过；`pnpm test` 6 个文件 20 条通过（新增 `diff-attribution.test.ts` 3 条）。
- 全量对比重跑两次（加差异归因前后的渲染没变）：`reports/fidelity/20261024-225829/`、`reports/fidelity/20261024-230214/`，都是 118 个用例平均 0.07%、118 个小于 1%、47 个逐像素一致，和 `20261024-223846` 一样。每个用例的 `breakdown.byKind` 加起来都等于 `diffPixels`（脚本核对，118/118）。
- 第一版归因把 `gemini-plugin-file-cover` 82% 的差异算给了一块半透明渐变遮罩 "Rectangle 1"，改成"只有盖住下面内容的节点才涂整个范围"（tech.md §10.2）后，这一页 100% 在文字上：「Hello, Team …」（Product Sans）、「Unofficial Recreation」（Red Hat Display 700，粗体比 Figma 窄，tech.md §6.4）。8 个图片滤镜用例 100% 在图片上；Gemini 其余页面 73%～100% 在文字上。
- 用 agent-browser 在 Chrome 里看过（1440×900，暗色和亮色）：列表页、按差异排序、Gemini 详情页、Untitled UI 手机长页面（0.5 倍，页面可以往下滚）、`text/cjk-mixed`；节点悬停的蓝框、← → Esc 键盘切换都正常。手动验收 10～12 条通过；"在 Figma 里打开"没有在浏览器里实际点开（链接指向用户的草稿，需要用户登录 Figma）。
- 发现并修好：tldraw 水印压在设计稿右下角（三格四周加 24px 白边）；长页面缩得太小（高度方向最少 0.5 倍）；只差十几个像素时比例显示成 0%（改成 <1%）。

### 2026-10-24（思路介绍页，用户追加）

- `pnpm lint`、`pnpm typecheck` 通过；`pnpm test` 20 条通过（这次没加单测，页面是静态内容加一个演示）。
- 用 agent-browser 在 Chrome 里看过（1440×900，亮色）：整页七节都在；节点树 25 行，类型从画布读出来（FRAME → figma-frame、ELLIPSE → figma-vector 等）；点 "Primary button" 行选中画布上的按钮，在画布上点 "Forgot password?" 高亮对应的行。手动验收第 13 条通过。
- 发现并修好：演示画布用了白色背景，白底的登录页看不出边界，改回 tldraw 默认的浅灰。整页截图时第 4 节的图和画布是空白的，是懒加载还没触发，正常滚动浏览时都显示。

## 5. Demo 结论（2026-10-24）

最后一份报告是 `reports/fidelity/20261024-211751/`（实测，macOS 上的 Playwright Chromium，真实 2 倍屏，pixelmatch 阈值 0.1）：**79 个用例平均差异 0.004%，全部小于 1%，65 个是 0.00%**，没有出错和警告。第一份报告是平均 0.53%、73 / 79 个小于 1%。

| 分类                    | 用例数 | 第一份报告最大差异               | 最后最大差异 | 主要靠哪次修复                                       |
| ----------------------- | ------ | -------------------------------- | ------------ | ---------------------------------------------------- |
| container               | 8      | 15.53%（group-opacity）          | 0.01%        | 矢量透明度不重复乘、透明组里裁掉被盖住的部分（§4.1） |
| effect                  | 6      | 5.62%（background-blur）         | 0.00%        | 背景模糊层放到裁剪层外面（tech.md §6.3）             |
| page                    | 3      | 2.40%（gallery）                 | 0.07%        | 抵消 0.125px 偏移、真实 2 倍屏、文字基线             |
| text                    | 12     | 2.36%（mixed-styles）            | 0.03%        | Inter 3.19、行高取整、基线补偿、装饰线（§6.4）       |
| stroke                  | 7      | 0.84%（dashed）                  | 0.00%        | 线帽重置、虚线按段排（tech.md §6.2）                 |
| layout                  | 4      | 0.68%（vertical-fill）           | 0.01%        | 文字基线                                             |
| blend                   | 1      | 0.62%（modes）                   | 0.04%        | 抵消 0.125px 偏移、真实 2 倍屏                       |
| image                   | 6      | 0.43%（tile）                    | 0.00%        | 同上                                                 |
| misc                    | 2      | 0.39%（subpixel）                | 0.01%        | 同上                                                 |
| fill                    | 9      | 0.21%（gradient-alpha、opacity） | 0.00%        | 同上                                                 |
| mask                    | 2      | 0.17%（ellipse-image）           | 0.00%        | 同上                                                 |
| component               | 1      | 0.06%                            | 0.00%        | 文字基线                                             |
| shape                   | 5      | 0.01%                            | 0.00%        | 一开始就基本一致                                     |
| boolean、radius、vector | 13     | 0.00%                            | 0.00%        | 一开始就一致                                         |

**还原得好的**：填充（纯色、四种渐变、多层、透明度）、描边（三种对齐、虚线、线帽、四边不同粗细、渐变描边）、阴影和模糊、圆角（包括四角不同和平滑圆角用例）、图片四种模式、旋转、frame 裁剪和嵌套、蒙版、布尔运算和矢量、组件实例、自动布局的结果、三个整页用例，在这些用例上都和 Figma 逐像素一致或只差几十个像素。

**还差一点的**（都在 0.1% 以下，见 §4 最后一段）：图片缩放取样（`page/gallery`）、混合模式下的文字边缘（`blend/modes`）、省略号截在单词中间还是单词之间（`text/truncation`）。

**用例全过不代表所有情况都对**，下面这些是已知的限制或只验证过一个用例的规则：

1. 组透明度只在上层兄弟是"完全不透明的简单形状"时准确（tech.md §4.1）。上层半透明、带渐变 / 图片 / 阴影、或者是任意矢量和文字时，重叠的地方还会透出来；要完全一致得把整个子树画进一个图形，属于架构改动，要先问用户。
2. 一段文字里混着不同字号时"大字只往上撑"的规则，只有 `text/mixed-styles` 一个用例支撑（tech.md §6.4）。大字在最后一行、或者一行里有好几种大字号时没验证过。
3. 文字的基线补偿、下划线和删除线位置只有 Inter 和 Noto Sans SC 的字体数据（`figma-text.tsx` 的 `FONT_METRICS`）。换别的字体时不补，可能差 1px。
4. 对比只在缩放 100%、真实 2 倍屏、macOS 的 Chromium 上做过（tech.md §7）。在 tldraw 里缩放画布、1 倍屏、Windows / Linux 的字体渲染都没量过。
5. 用例是插件生成的 79 个单特性用例（含 3 个整页），真实项目里的大稿子（几百上千个节点、组件层层嵌套）没有试过，渲染性能也没测（Demo 不做）。
   > 2026-10-24 修订：后来用 Figma 社区的 31 个整页考过一次，见 §6。
6. 每个图层只能选中和移动，缩放、旋转、改文字都没做（施工计划 §7 定的）。

下一步可以考虑的方向（交给用户决定）：拿一两页真实设计稿导进来看看；组透明度的一般情况要不要做架构改动；量一下画布缩放以后的还原度；交接文档里 Demo 阶段不做的 WebSocket 中转、写回 Figma、数据精简和性能优化。

## 6. 真实稿子考试（2026-10-24）

稿子都来自 Figma 社区的免费文件（用户拍板：用户手上没有真实项目；复制到用户草稿这一步由我用 computer use 做）：

| 文件                                                   | 挑了哪些                                                                       | 用例数 | 字体                                 | 每页节点数 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | ------ | ------------------------------------ | ---------- |
| Untitled UI – FREE Figma UI kit and design system v2.0 | Settings pages、Dashboards、Informational pages 三页，每页 4 个桌面 + 4 个手机 | 24     | Inter                                | 186～621   |
| Google Gemini - Built with Material 3 Design Kit       | 4 个 MacBook Pro 14" 页面、插件封面、两张 Dribbble 图                          | 7      | Product Sans、Red Hat Display、Inter | 114～489   |

原计划里的 Google 官方 Material 3 Design Kit 没用：它的页面写着下载即同意 Google 服务条款，要先问用户。

报告 `reports/fidelity/20261024-215318/`（实测，同 §5 的环境），没改任何渲染规则：

| 分组        | 用例数 | 平均差异 | 小于 1% | 0.00% | 最大差异 |
| ----------- | ------ | -------- | ------- | ----- | -------- |
| 原来的用例  | 79     | 0.004%   | 79      | 65    | 0.07%    |
| Untitled UI | 24     | 0.02%    | 24      | 15    | 0.17%    |
| Gemini      | 7      | 8.39%    | 1       | 0     | 41.74%   |
| 新用例合计  | 31     | 1.91%    | 25      | 15    | 41.74%   |

**Untitled UI 只用 Inter，24 页全部在 0.17% 以下**，说明第 4 步的规则在没见过的稿子上也成立。剩下的差异没有逐张细看。

Gemini 7 页：

| 用例                                         | 差异   | 主要原因                                     |
| -------------------------------------------- | ------ | -------------------------------------------- |
| gemini-dribbble-thumbnail                    | 41.74% | 背景大图的滤镜没画；卡片叠放顺序反了；缺字体 |
| gemini-dribbble-screenshot                   | 9.64%  | 同上，加上文字渐变                           |
| gemini-macbook-pro-14---existing-chat-screen | 1.91%  | 缺字体                                       |
| gemini-macbook-pro-14---new-chat-screen      | 1.84%  | 缺字体、卡片叠放顺序、文字渐变               |
| gemini-macbook-pro-14---extension-screen     | 1.41%  | 缺字体、卡片叠放顺序                         |
| gemini-plugin-file-cover                     | 1.37%  | 缺两种字体、卡片叠放顺序、文字渐变           |
| gemini-macbook-pro-14---public-links-screen  | 0.79%  | 缺字体                                       |

按特性归类（数字是出现次数）：

| 原因                                                                                      | 出现在                                                                                           | 难度 | 怎么修                                                              |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------- |
| 缺字体 Product Sans                                                                       | 全部 7 页                                                                                        | —    | Google 的专有字体，没有网页版；只能由用户提供字体文件，否则接受差异 |
| 缺字体 Red Hat Display                                                                    | plugin-file-cover                                                                                | 低   | 免费字体，装 `@fontsource` 的包                                     |
| 自动布局的 First on top 叠放（`itemReverseZIndex: true`），卡片背景盖住了上面的文字和图标 | 21 个 Stacked card 实例：screenshot 8、thumbnail 4、new-chat 4、plugin-file-cover 4、extension 1 | 低   | 转换时把这类 frame 的子节点倒过来排                                 |
| 图片滤镜（`filters`：曝光、对比度、饱和度、色调、高光），背景图还叠了 48px 的图层模糊     | thumbnail 2、screenshot 1                                                                        | 中   | 用 CSS `filter` 或 SVG 滤镜近似，色调和高光要自己推算               |
| 文字的渐变填充（`styleOverrideTable` 里的 `GRADIENT_LINEAR`，如 "Hello, Team"）           | screenshot 2、thumbnail 1、new-chat 1、plugin-file-cover 1                                       | 中   | CSS `background-clip: text`                                         |

考完按我建议的顺序修了四项，又给 Product Sans 找了代替字体（用户还没回复先修哪些），每行是改完以后重跑受影响的 Gemini 用例：

| 修了什么                                                                   | 用例                                     | 修之前 | 修之后 |
| -------------------------------------------------------------------------- | ---------------------------------------- | ------ | ------ |
| First on top 叠放：子节点倒过来排（tech.md §4.3）                          | gemini-macbook-pro-14---new-chat-screen  | 1.84%  | 1.56%  |
|                                                                            | gemini-dribbble-thumbnail                | 41.74% | 41.58% |
|                                                                            | gemini-dribbble-screenshot               | 9.64%  | 9.50%  |
|                                                                            | gemini-macbook-pro-14---extension-screen | 1.41%  | 1.41%  |
|                                                                            | gemini-plugin-file-cover                 | 1.37%  | 1.49%  |
| 装上 Red Hat Display 400、700（tech.md §6.4）                              | gemini-plugin-file-cover                 | 1.49%  | 1.39%  |
| 文字渐变填充：叠一层只露渐变文字的 `background-clip: text`（tech.md §6.7） | gemini-macbook-pro-14---new-chat-screen  | 1.56%  | 1.49%  |
|                                                                            | gemini-plugin-file-cover                 | 1.39%  | 1.34%  |
|                                                                            | gemini-dribbble-screenshot               | 9.50%  | 9.44%  |
|                                                                            | gemini-dribbble-thumbnail                | 41.58% | 41.54% |
| 图片滤镜：插件导出时让 Figma 渲染带滤镜的图（tech.md §6.8）                | gemini-dribbble-thumbnail                | 41.54% | 1.09%  |
|                                                                            | gemini-dribbble-screenshot               | 9.44%  | 0.84%  |
| Product Sans 用 Google Sans Flex（字宽 93.5）代替（tech.md §6.9）          | Gemini 7 页平均                          | 1.27%  | 0.87%  |
| Figma 文字的字体特性重置成 `normal`（tech.md §6.9）                        | Gemini 7 页平均                          | 0.87%  | 0.53%  |

封面修完叠放顺序反而变高：卡片上的文字原来被背景盖住，现在露出来了，但用的是后备字体 Inter（缺 Product Sans），比 Figma 宽、换行也不一样，差异算进来了。卡片本身已经和 Figma 一样（文字、图标都在背景上面）。其他 103 个用例里没有 `itemReverseZIndex`，没有重跑。

7 个 Gemini 用例重跑（`reports/fidelity/20261024-220745/`）：平均 8.39% → 8.31%。剩下的大头是图片滤镜（两张 Dribbble 图）和缺 Product Sans。

文字渐变修完以后，"Hello, Team" 从蓝到粉的过渡和 Figma 一样，下面一行灰字没有被染色；剩下的差别是字体（Inter 代替 Product Sans，字更宽）。

三项修完全量重跑（`reports/fidelity/20261024-221207/`，110 个用例）：原来 79 个和 Untitled UI 24 页的分数都没变；Gemini 7 页平均 8.39% → 8.28%，31 个新用例平均 1.91% → 1.89%，小于 1% 的还是 25 个。剩下的大头是两张 Dribbble 图的图片滤镜（41.54%、9.44%）和全部 7 页缺 Product Sans。

图片滤镜（2026-10-24）：插件加了 8 个 `image-filter/*` 用例（tech.md §6.8），第一次导出用插件 API 的滤镜值算 key，`contrast` 和 `combined` 两个用例对不上（4.53%、29.87%）；改成用 REST 数据里的值算以后（`reports/fidelity/20261024-222510/`）8 个都在 0.50% 以下，平均 0.41%。剩下的差异只在色卡相邻两行的分界线上，一个像素宽，没加滤镜的那块色卡也一样，是图片放大取样方式不同，和滤镜无关。Gemini 7 页用新插件重新导出。

四项修完全量重跑（`reports/fidelity/20261024-222808/`，118 个用例，实测）：**平均差异 0.11%，113 / 118 个小于 1%**。

| 分组               | 用例数 | 平均差异      | 小于 1% | 最大差异       |
| ------------------ | ------ | ------------- | ------- | -------------- |
| 原来的用例         | 79     | 0.004%        | 79      | 0.07%          |
| 图片滤镜用例（新） | 8      | 0.41%         | 8       | 0.50%          |
| Untitled UI        | 24     | 0.02%         | 24      | 0.17%          |
| Gemini             | 7      | 8.39% → 1.27% | 1 → 2   | 41.74% → 1.91% |
| 真实稿子合计       | 31     | 1.91% → 0.30% | 25 → 26 |                |

还超过 1% 的 5 个都是 Gemini 页面（1.09%～1.91%），警告里只剩缺 Product Sans。留作考试的 `gemini-macbook-pro-14---public-links-screen` 一直是 0.79%（这几项修复都没有涉及它），`informational-pages-mobile-2` 一直是 0.17%。

补上字体代替、重置字体特性以后全量重跑（`reports/fidelity/20261024-223846/`，118 个用例，实测）：**平均差异 0.07%，118 / 118 个小于 1%**。原来 79 个、图片滤镜 8 个、Untitled UI 24 页的分数都没变；Gemini 7 页平均 1.27% → 0.53%，最大 0.97%（`extension-screen`）。31 个真实稿子平均 0.14%，全部小于 1%。警告只剩"Product Sans 用 Google Sans Flex 近似代替"。留作考试的两页：`public-links-screen` 0.79% → 0.22%（字体代替规则对它也管用，拟合字宽时没看它的差异图），`informational-pages-mobile-2` 0.17% 没变。

剩下的差异都是文字字形（代替字体和 Product Sans 本来就不一样）和图片取样，属于目标里说的"1% 以下的细微差异"，没有继续追。
