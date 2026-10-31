---
name: doc-system
title: 文档体系
description: apps/docs/ 里按功能模块组织的文档怎么写、怎么查：feature-docs skill（.claude/skills/feature-docs/）的写法规则、由各模块 frontmatter 生成的总索引（scripts/docs/index.mjs → apps/docs/README.md）、代码引用和文档链接检查（scripts/docs/check-refs.mjs）、代码注释只写一行文档引用的约定，以及这些检查怎么并进 pnpm lint。新建文档模块、改模块头部、改文档标题或章节编号、pnpm lint 报文档错误、想知道代码里为什么不写说明性注释时来读。
changes: [2026-10-21, 2026-10-22, 2026-10-31]
status: 已上线
code:
  - .claude/skills/feature-docs/SKILL.md
  - scripts/docs/index.mjs
  - scripts/docs/check-refs.mjs
---

# 文档体系

设计和施工记录都放在 `apps/docs/`，一个功能模块一个目录。`apps/docs/README.md` 是总索引，由 `pnpm docs:index` 从各模块 `README.md` 的头部生成，列出每个模块管什么、哪天施工过、状态。写法规则在 `feature-docs` skill 里，Claude 写文档时按它来。代码里不写说明性注释，只留一行指向文档章节的引用，所以章节编号只增不改。`pnpm lint` 最后一步会检查索引是否最新、代码引用和文档链接是否都对得上。

## 关键决定

- skill 和两个检查脚本从 ludict 项目移植过来，按本仓库改写（用户要求，2026-10-21，见 [tech.md §5](tech.md#5-从-ludict-移植时改了什么2026-10-21)）
- 模板没有版本号，所有"版本"位置改用日期 `YYYY-MM-DD`，frontmatter 字段叫 `changes`（用户拍板，2026-10-21，见 [tech.md §5](tech.md#5-从-ludict-移植时改了什么2026-10-21)）
- 同时引入「代码注释」规则：说明只写在文档里，代码只留引用；现有注释不批量清理，改到哪挪到哪（用户拍板，2026-10-21，见 [tech.md §4](tech.md#4-代码注释约定2026-10-21)）
- 仓库没有 CI，文档检查并进 `pnpm lint`（2026-10-21，见 [tech.md §1](tech.md#1-目录结构与读法2026-10-21)）
- 原来的三份 ADR（`decisions/0001`～`0003`）按主题改写进 toolchain、commit-workflow、lint-format 三个模块（commit-workflow 2026-10-31 又并进了 `CLAUDE.md`），原文件删除；会话开始时通读全部文档的 `read-docs` skill 也删除（2026-10-21，见 [plan.md](plan.md)）
- 功能、设计、计划、调研放 `apps/docs/`；项目怎么搭、怎么干活的规矩放 `CLAUDE.md` 和 `.claude/` 下的 skill、命令，根目录不建 `docs/`。据此把根目录 `docs/` 挪进 figma-to-tldraw 模块和 `CLAUDE.md`，commit-workflow 模块并进 `CLAUDE.md`「Git 提交约定」（用户要求，2026-10-31，见 [plan.md](plan.md)）

## 文件

| 文件               | 内容                                                                                                                                                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [tech.md](tech.md) | §1 目录结构、三层读法、三个命令；§2 索引脚本（frontmatter 格式、`code` 路径检查、用 oxfmt 格式化输出）；§3 引用检查脚本（代码引用、编号不重复、链接与锚点、不在 git 仓库里时跳过）；§4 代码注释约定；§5 和 ludict 原版的差异；风险表                                                                        |
| [plan.md](plan.md) | 2026-10-21 一次施工：移植 skill、移植脚本、改写三份 ADR 和 TS 7 调研、改 CLAUDE.md，以及原文件内容的去向表；2026-10-22 按 code review 修复 `check-refs.mjs`（中文文件名、仓库根路径的链接、坏的 `%` 转义、不在 git 仓库里）；2026-10-31 整理文档放哪：根目录 `docs/` 挪走、commit-workflow 并进 `CLAUDE.md` |

## 相关模块

- [代码规范与格式化](../lint-format/README.md)：`pnpm lint` 的入口；PostToolUse hook 也会格式化 Claude 写的文档。
