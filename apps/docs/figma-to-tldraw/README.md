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
---

# Figma 还原到 tldraw

把 Figma 里的设计稿画到 tldraw 画布上，再和 Figma 自己导出的图片逐像素对比，算出还原度。数据由自己写的 Figma 插件导出成 `cases/`（每个用例一份快照 JSON 加一张 Figma 渲染的 2 倍图）。每个 Figma 节点变成一个 tldraw 自定义图形，图形里用普通的 HTML、CSS 和 SVG 按 Figma 的样式画，不用 tldraw 自带的手绘风格图形。对比脚本用 Playwright 截图、pixelmatch 算差异，生成按差异排序的报告。

施工计划（todo 清单）在仓库根目录的 [`docs/施工计划.md`](../../../docs/施工计划.md)，交接时的原始材料在 [`docs/handoff/`](../../../docs/handoff/HANDOFF.md)。

## 关键决定

- 用 seed 项目 hono-mono-starter 做底座，tldraw 用 3.x 的最新版 3.15.6（用户拍板，2026-10-24）
- 每个 Figma 节点对应一个 tldraw 自定义图形，推翻了交接文档里"Demo 先整个 section 一个图形"的做法（用户拍板，2026-10-24，见 [tech.md §3](tech.md#3-自定义图形2026-10-24)）
- tldraw 3.x 只有自带的 `frame` 能裁剪子图形，所以裁剪和蒙版由子图形自己用 CSS `clip-path` 做（2026-10-24，见 [tech.md §2](tech.md#2-tldraw-3x-的限制2026-10-24) 和 [§5](tech.md#5-裁剪和蒙版2026-10-24)）
- 取数据用自己写的 Figma 插件，不用 REST API 和 MCP；Demo 阶段不做 WebSocket、写入 Figma、去默认值和性能优化（交接文档已定）

## 文件

| 文件               | 内容                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| [tech.md](tech.md) | §1 链路和快照格式；§2 tldraw 3.x 的限制；§3 四种自定义图形；§4 节点树拆成图形的转换；§5 裁剪和蒙版；§6 样式怎么画；§7 对比脚本；§8 风险 |

## 相关模块

- [代码规范与格式化](../lint-format/README.md)：插件代码是不经过打包的纯 JS，在 `.oxlintrc.json` / `.oxfmtrc.json` 里排除了 `apps/figma-plugin/**`。
