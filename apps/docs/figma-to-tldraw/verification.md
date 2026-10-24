# Figma 还原到 tldraw：验证方案

> 相关：[模块说明](README.md) · [技术实现](tech.md) · 施工计划 [`docs/施工计划.md`](../../../docs/施工计划.md)

## 1. 自动测试

| 测试文件                                  | 测什么                                                                                                                                        | 日期       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `apps/client/src/figma/to-shapes.test.ts` | 节点树拆成图形：根节点放原点、子节点相对父节点、旋转节点用 `transforms`、隐藏节点跳过、兄弟顺序、不认识的类型给警告、矢量按渲染范围摆放和蒙版 | 2026-10-24 |
| `apps/client/src/figma/geometry.test.ts`  | 圆角矩形拆成四条边和四个角（虚线按段排用），段长正确；没有圆角时不出现长度为 0 的角                                                           | 2026-10-24 |

命令：`pnpm --filter @figma-to-tldraw/client test`。

## 2. 端到端检查

| 检查                                             | 预期                                                                  | 日期       |
| ------------------------------------------------ | --------------------------------------------------------------------- | ---------- |
| `pnpm dev` 后打开 `http://localhost:5173/canvas` | 左侧是用例列表，画布上是示例 frame                                    | 2026-10-24 |
| `curl localhost:5173/cases/index.json`           | 200，返回用例列表                                                     | 2026-10-24 |
| `pnpm --filter @figma-to-tldraw/client compare`  | 跑完全部用例，在 `reports/fidelity/<时间>/` 生成报告，`latest` 指向它 | 2026-10-24 |
| `pnpm lint`、`pnpm typecheck`、`pnpm test`       | 都通过                                                                | 2026-10-24 |

## 3. 手动验收清单

1. 打开 `/canvas?case=fill/solid` → 画布上是一个白色 frame 和一个蓝色矩形；点工具条上的"差异" → frame 区域全黑。
2. 在左侧列表点任意用例 → 网址里的 `case` 跟着变，刷新后还是这个用例。
3. 打开 `/canvas?case=page/mobile-login` → 登录页完整显示，中文和英文字体正确。
4. 在画布上点一个子图形 → 只选中这一个；拖动根 frame → 子图形跟着动。
5. 打开 `/canvas?case=不存在` → 工具条显示 1 条警告（读取失败 404），页面不崩。
6. 打开 `reports/fidelity/latest/index.html` → 顶部有用例数、平均差异、小于 1% 的个数；表格按差异从大到小排，每行三张图。

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
