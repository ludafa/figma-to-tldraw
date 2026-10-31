---
name: product-direction
title: 产品方向和计划
description: 我们现在的目标和接下来的计划：把 Figma 里沉淀的设计稿导进自研的 Skia 产品、以后不回 Figma；agent 读写设计稿是主要场景、设计师在画布上看稿和手改是次要场景；代码优先（设计稿表达成借 React Native 外形、按 Figma 语义的"方言"代码，画布用的 JSON 从代码算出来，画布改动写回代码）；用 88 个真实页面统计出的数据（实例、覆盖、组件库、样式）对方案的修正；代码和画布双向转换要满足的规则；"可交互设计稿还能不能手工改"的调研（Framer、Plasmic、Builder.io、CrossUI Studio、Utopia、Figma Make）和建议的交互写法；离开 Figma 必须自己补的能力；建议的施工顺序和待定问题；介绍这些的页面 /roadmap（apps/client/src/pages/roadmap.tsx）；把所有页面收拢起来的首页 /（apps/client/src/pages/home.tsx）。讨论产品方向、要开始做方言或可交互、想知道某件事定了没有时来读。
changes: [2026-10-31]
status: 设计中
code:
  - apps/client/src/pages/roadmap.tsx
  - apps/client/src/routes/roadmap.tsx
  - apps/client/src/pages/home.tsx
  - apps/client/src/routes/index.tsx
---

# 产品方向和计划

目标是把 Figma 里沉淀的设计资产搬进我们自研的 Skia 设计产品，搬完就留在这边，不再回 Figma。agent 在这里读懂、修改设计稿是主要场景；设计师在这里看稿、手工改稿，体验和 Figma 一样，是次要场景。设计稿以**代码**为准：用借 React Native 外形、按 Figma 语义的"方言"写，画布用的 JSON 从代码算出来，设计师在画布上的改动由转换层写回代码。这个模块只有设计，还没开工；现有的还原、编辑、组件、变量能力在 [Figma 还原](../figma-to-tldraw/README.md) 和 [Skia 引擎](../skia-engine/README.md) 两个模块里。

## 关键决定

- 不回 Figma：写回 Figma 的整套同步（插件执行器、新节点 id 回填、和 Figma 当前状态三方比较）不做（用户说明，2026-10-30，见 [product.md §2](product.md#2-已经定下的事2026-10-30)）
- 代码优先：代码是真实数据，JSON 给画布用；agent 读写是主要场景，手工编辑是次要场景；转换层要让画布上的修改"无感"地改进代码（用户拍板，2026-10-30，见 [product.md §2](product.md#2-已经定下的事2026-10-30)）
- 覆盖按主组件里图层的 id 写，不按名字：变体里 65% 的图层名字路径重复（2026-10-30 实测，见 [product.md §4](product.md#4-真实数据说明了什么2026-10-30-实测)）
- 可交互设计稿建议只用编辑器认得的几种写法（状态、绑定、按状态的样式、重复、条件、事件），任意代码画布上只读、交给 agent（建议，用户未确认，2026-10-30，见 [probe-interactive-editing.md](probe-interactive-editing.md)）
- 介绍页 `/roadmap` 把上面这些讲给人看，内容和 product.md 一致（2026-10-31，见 [tech.md §1](tech.md#1-介绍页-roadmap2026-10-31)）
- 首页 `/` 按"方向、看成果、动手试"三组列出所有页面，不用登录；Notes 示例挪到 `/notes`（用户追加，2026-10-31，见 [tech.md §4](tech.md#4-首页-2026-10-31)）

## 文件

| 文件                                                         | 内容                                                                                                                                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [product.md](product.md)                                     | §1 目标；§2 已经定下的事；§3 整体怎么运转；§4 真实数据说明了什么；§5 方言要改的地方；§6 代码和画布的双向转换；§7 可交互设计稿；§8 离开 Figma 必须补的；§9 待定的问题；§10 范围与非目标；§11 成功标准 |
| [probe-interactive-editing.md](probe-interactive-editing.md) | 调研：带状态、循环、条件的设计稿还能不能在画布上手工改。四类做法（行为挂在图层外、只认几种逻辑、解析代码改语法树、交给 agent）、各产品的细节和出处、对我们的建议                                     |
| [tech.md](tech.md)                                           | §1 介绍页 `/roadmap`：页面结构、数字从哪来、和 product.md 怎么保持一致；§2 真实页面的统计方法；§3 风险；§4 首页 `/`：放在哪、列哪些页面、加新页面时改哪、线上为什么还跳 `/showcase`                  |
| [plan.md](plan.md)                                           | 2026-10-31 做介绍页和首页；建议的施工路线（勾选清单，都没开工）                                                                                                                                      |

## 相关模块

- [Figma 还原到 tldraw](../figma-to-tldraw/README.md)：插件导出、快照格式、组件、变量、编辑器，都是这里的基础
- [自研 Skia 画面引擎](../skia-engine/README.md)：画布和渲染
