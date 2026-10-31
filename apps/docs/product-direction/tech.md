# 产品方向和计划：技术实现

> 相关：[模块说明](README.md) · [产品设计](product.md) · [调研：可交互设计稿的手工编辑](probe-interactive-editing.md) · [施工计划](plan.md)

## 1. 介绍页 /roadmap（2026-10-31）

用户要"在 client 项目里做一个页面，来详细介绍我们现在的目标和计划"（用户追加）。页面是 `apps/client/src/pages/roadmap.tsx` 的 `RoadmapPage`（新），路由 `apps/client/src/routes/roadmap.tsx`（新），和 `/report`、`/how-it-works` 一样放在 `routes/` 顶层，不走 `_app` 的登录。写法照 `pages/report.tsx`：内容写成文件里的常量数组，`Section` / `Table` 是页面自己的小组件。

**内容和 [product.md](product.md) 一一对应，改了一边要改另一边。** 页面按 product.md 的顺序讲：目标（§1）、已经定下的事（§2）、整体怎么运转和代码长什么样（§3）、已经有的基础、真实数据（§4）、方言要改的地方（§5）、代码和画布的双向转换（§6）、可交互设计稿（§7，带调研的四类做法和出处）、离开 Figma 必须补的（§8）、计划（[plan.md](plan.md) 的路线）、待定的问题（§9）。"已经有的基础"一节是页面自己加的，数字来自 figma-to-tldraw 模块的 tech.md §13.2、§13.3、§16、§21。

**顶上三个还原度数字是活的。** 和 `/report` 一样用 `figma/report.ts` 的 `loadLatestReport()` 读 `reports/fidelity/latest/results.json`，显示用例数、平均差异、差异小于 1% 的个数；读不到（比如线上没导出报告）就不显示这一行。其余数字都是 2026-10-30 统计时写死的，见 §2。

**每个计划步骤标状态。** 现在都是"未开始"；开工以后改 `STEPS` 里的 `status`，和 plan.md 的勾选清单一起改。

## 2. 真实页面的统计方法（2026-10-30）

product.md §4 的数字是对 `cases/index.json` 里 `dir` 以 `real/` 开头的 88 个用例（6 套社区稿子：50+ Landing 30、Untitled UI 24、Furniture 19、E-Learning 8、Golio 5、SaaS Framer 2）跑一次性的 Python 脚本得来的，脚本没有进仓库。读每个 `snapshot.json`：

- 页面节点：从 `rest.document` 往下数所有节点；主组件另外从 `mains` 里数。
- "在实例里"：有一个祖先是 `INSTANCE`。"最外层实例"：自己是 `INSTANCE`、祖先里没有。
- 覆盖：最外层实例的 `overrides` 条数和每条的 `overriddenFields`（这是导出时的原始数据，不是 `components.ts` 重建以后补全的）。
- 名字路径重复：在 Untitled UI dashboards-desktop 的每个变体里，从变体根往下拼 `/名字/名字`，同一个路径出现不止一次的图层都算。
- 默认名：名字匹配 `Frame`、`Group`、`Rectangle`、`Vector` 等后面跟数字。
- "父图层不是自动布局"：父节点的 `layoutMode` 不是 `HORIZONTAL` / `VERTICAL` / `GRID`，或者自己是 `layoutPositioning: ABSOLUTE`。
- 可折叠的纯矢量组：不在实例里、类型是 `GROUP` / `FRAME`、所有后代都是矢量类节点的子树根。

## 3. 风险

| 风险                                                                                           | 应对                                                                           |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 页面内容和 product.md 写了两份，改了一边忘了另一边                                             | §1 写明一一对应；改方向时两边一起改                                            |
| 统计用的是组件很多的 UI kit，产品稿的比例会不一样；脚本没进仓库，不能直接重跑                  | 拿到真实产品稿时按 §2 的口径重算；要常用就写成 `apps/client/scripts/` 下的脚本 |
| 调研全是看资料，没有试用；CrossUI Studio 只有宣传文章，Utopia、Onlook 的循环处理没找到正式说明 | 开工做 §7 之前，挑一两个产品实际试用                                           |
| 线上（Vercel）导出时 `reports/` 里只有用例对应的结果，数字和本地可能不一样                     | 页面写明数字来自哪次对比（`startedAt`）                                        |

## 4. 首页 /（2026-10-31）

用户要"做一个首页把我们所有页面收拢一下"（用户追加）。页面是 `apps/client/src/pages/home.tsx` 的 `HomePage`（新），路由 `apps/client/src/routes/index.tsx`（新）。

- **放在 `routes/` 顶层，不走 `_app` 的登录。** 和 `/roadmap`、`/report` 一样，不调后端接口，没有服务端（比如 Vercel 上的静态站）也能打开。原来占着 `/` 的模板 Notes 示例挪到 `/notes`，见 [登录与账号 tech.md §4](../auth/tech.md#4-notes-示例挪到-notes2026-10-31)。
- **内容。** 顶上一段话和三个还原度数字（`loadLatestReport()`，读不到就不显示），下面按三组列出所有页面，每个页面一张卡片：名字、地址、一两句说明、上线日期，整张卡片点了就跳过去。

  | 组     | 页面                                      |
  | ------ | ----------------------------------------- |
  | 方向   | `/roadmap`                                |
  | 看成果 | `/showcase`、`/how-it-works`、`/report`   |
  | 动手试 | `/canvas`、`/import`、`/compare`、`/demo` |

  `/notes`（要服务端）、`/login`、`/register`（会跳到 `/`）不列，页脚写一句 Notes 在哪。

- **加新页面时**在 `GROUPS` 里加一项，地址同时加进 `PagePath`（`Link` 的 `to` 要的是已有路由的字面量类型）。
- `/roadmap` 顶部导航加了"首页"。别的页面（`/report`、`/showcase`、`/canvas` 等）还没有回首页的链接。

**线上还是跳到 `/showcase`。** Vercel 的配置里写着 `/` 跳 `/showcase`（`apps/client/scripts/export-static.ts` 的 `VERCEL_CONFIG.redirects`，见 figma-to-tldraw tech.md §18）。要让线上也显示首页，删掉这条跳转再部署；这次没改，因为另一个会话正在改这个文件。
