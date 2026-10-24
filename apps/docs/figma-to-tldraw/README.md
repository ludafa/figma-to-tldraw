---
name: figma-to-tldraw
title: Figma 还原到 tldraw
description: 把 Figma 设计稿画到 tldraw 画布上并量还原度的 Demo：Figma 插件（apps/figma-plugin/，生成 79 个测试用例、导出 cases/ 快照）、快照格式（snapshot.json 的 meta / rest / svgs / transforms）、节点树拆成 tldraw 自定义图形的转换（apps/client/src/figma/to-shapes.ts）、figma-frame / figma-rect / figma-text / figma-vector 四种图形怎么画填充、描边、阴影、文字、裁剪和蒙版、/canvas 页面、Playwright + pixelmatch 对比脚本和报告。改渲染、加新的 Figma 特性、看还原度报告、改插件导出格式时来读。
changes: [2026-10-24]
status: 开发中
code:
  - apps/figma-plugin/
  - apps/client/src/figma/
  - apps/client/src/pages/canvas.tsx
  - apps/client/scripts/compare.ts
  - apps/client/scripts/import-cases.ts
---

# Figma 还原到 tldraw

把 Figma 里的设计稿画到 tldraw 画布上，再和 Figma 自己导出的图片逐像素对比，算出还原度。数据由自己写的 Figma 插件导出成 `cases/`（每个用例一份快照 JSON 加一张 Figma 渲染的 2 倍图）。每个 Figma 节点变成一个 tldraw 自定义图形，图形里用普通的 HTML、CSS 和 SVG 按 Figma 的样式画，不用 tldraw 自带的手绘风格图形。对比脚本用 Playwright 截图、pixelmatch 算差异，生成按差异排序的报告。

施工计划（todo 清单）在仓库根目录的 [`docs/施工计划.md`](../../../docs/施工计划.md)，交接时的原始材料在 [`docs/handoff/`](../../../docs/handoff/HANDOFF.md)。

## 关键决定

- 用 seed 项目 hono-mono-starter 做底座，tldraw 用 3.x 的最新版 3.15.6（用户拍板，2026-10-24）
- 每个 Figma 节点对应一个 tldraw 自定义图形，推翻了交接文档里"Demo 先整个 section 一个图形"的做法（用户拍板，2026-10-24，见 [tech.md §3](tech.md#3-自定义图形2026-10-24)）
- tldraw 3.x 只有自带的 `frame` 能裁剪子图形，所以裁剪和蒙版由子图形自己用 CSS `clip-path` 做（2026-10-24，见 [tech.md §2](tech.md#2-tldraw-3x-的限制2026-10-24) 和 [§5](tech.md#5-裁剪和蒙版2026-10-24)）
- Demo 结果：79 个用例平均差异 0.004%，全部小于 1%，65 个逐像素一致；已知限制和下一步见 [verification.md §5](verification.md#5-demo-结论2026-10-24)（2026-10-24）
- 用 Figma 社区的 31 个整页考了一次（不改规则）：只用 Inter 的 Untitled UI 24 页都在 0.17% 以下；Gemini 7 页平均 8.39%，原因是缺字体、First on top 叠放、图片滤镜、文字渐变，之后按特性修了叠放、Red Hat Display、文字渐变、图片滤镜四项，Gemini 平均降到 1.27%，剩下的是缺 Product Sans（2026-10-24，见 [verification.md §6](verification.md#6-真实稿子考试2026-10-24)）
- 图片滤镜不自己算，插件导出时让 Figma 渲染一份带滤镜的图（2026-10-24，见 [tech.md §6.8](tech.md#68-图片滤镜2026-10-24真实稿子考试补)）
- 取数据用自己写的 Figma 插件，不用 REST API 和 MCP；Demo 阶段不做 WebSocket、写入 Figma、去默认值和性能优化（交接文档已定）

## 文件

| 文件                               | 内容                                                                                                                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [tech.md](tech.md)                 | §1 链路和快照格式；§2 tldraw 3.x 的限制；§3 四种自定义图形；§4 节点树拆成图形的转换；§5 裁剪和蒙版；§6 样式怎么画；§7 对比脚本；§8 风险；§9 用真实稿子考试：插件导出真实稿子、`import-cases` 合并用例、按渲染范围截图、大窗口、缺字体警告 |
| [verification.md](verification.md) | §1 单测；§2 端到端检查；§3 手动验收清单；§4 各次实际结果，包括每份还原度报告的平均差异和差异最大的用例；§5 Demo 结论：最后一份报告、各分类前后对比、已知限制和下一步；§6 真实稿子考试：用了哪些社区稿子、成绩、没还原的原因归类           |

## 相关模块

- [代码规范与格式化](../lint-format/README.md)：插件代码是不经过打包的纯 JS，在 `.oxlintrc.json` / `.oxfmtrc.json` 里排除了 `apps/figma-plugin/**`。
