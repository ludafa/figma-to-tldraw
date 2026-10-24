---
name: lint-format
title: 代码规范与格式化
description: 全仓库一套 Oxlint + Oxfmt（根目录 .oxlintrc.json / .oxfmtrc.json，没有 ESLint、Prettier）：规则组成（correctness 分类 + 其余 recommended + curly / one-var）、只在 client 开的 react 规则、import 和 Tailwind class 排序、pnpm lint / format / lint:fix 各做什么、scripts/format.sh 为什么跑两遍 oxlint --fix 且第一遍关掉 prefer-const / no-var、VS Code 的 oxc 扩展、Claude 改文件后自动修复的 PostToolUse hook、提交时用 lint-staged 格式化暂存文件的 pre-commit 钩子（.husky/pre-commit，为什么加 --no-stash）、只对 JS 文件开的 no-undef、Kubb 生成代码的格式化、类型感知规则为什么没开、oxlint prefer-const 自动修复的已知 bug。改 lint 规则或格式化选项、看不懂 pnpm lint 的报错、编辑器保存或提交时的自动格式化不对、想开类型感知规则时来读。
changes: [2026-10-21, 2026-10-22]
status: 已上线
code:
  - .oxlintrc.json
  - .oxfmtrc.json
  - package.json
  - scripts/format.sh
  - .husky/pre-commit
  - .claude/settings.json
  - figma-to-tldraw.code-workspace
  - apps/client/kubb.config.ts
---

# 代码规范与格式化

全仓库只有一套 lint 和格式化：Oxlint 查代码问题，Oxfmt 管格式，配置都在根目录，两个 app 共用。`pnpm lint` 做总检查，有 warning 也失败；`pnpm format` 先用 oxlint 自动修复再格式化，效果和在 VS Code 里保存一样。Claude 每次改完一个文件，PostToolUse hook 会对那个文件做同样的事；提交时 pre-commit 钩子再对暂存的文件做一遍。三处共用 `scripts/format.sh`，所以代码风格不用靠人记，也不写进 CLAUDE.md。全量检查约 0.3 秒，原来的 ESLint 要约 1.8 秒（实测）。

## 关键决定

- 用 Oxlint + Oxfmt 整体替换 ESLint + Prettier，没选 Biome：规则名和 ESLint 一致，迁移近乎 1:1（用户委托选型，2026-10-21，见 [tech.md §1](tech.md#1-选型2026-10-21)）
- 只有一份根配置，子包不建配置、不留 `lint` 脚本；client 专属规则放 `apps/client/**` override（2026-10-21，见 [tech.md §2.1](tech.md#21-一份根配置)）
- 规则 = correctness 分类 + 其余 recommended 显式列出 + `curly: all`、`one-var: never`（后两条用户追加，见 [tech.md §3](tech.md#3-规则组成2026-10-212026-10-22-修订)）
- 格式化工具不改代码结构，所以 `pnpm format` = 两遍 `oxlint --fix` + `oxfmt`（用户要求"format 出来的也符合 lint"，见 [tech.md §2.2](tech.md#22-命令)）；2026-10-22 收进 `scripts/format.sh`，`pnpm format`、hook、pre-commit 共用（code review 指出，用户要求修复）
- 代码风格交给 hook，不写进 CLAUDE.md（用户确认，见 [tech.md §6.2](tech.md#62-claude-code-的-posttooluse-hook)）
- Kubb 生成的 `src/gen/**` 由 oxfmt 格式化，不能加进 oxfmt 的忽略列表（计划外发现，见 [tech.md §5](tech.md#5-生成文件2026-10-21)）
- 类型感知规则暂不开：要先升 TypeScript 7（用户拍板"先不加"，见 [tech.md §3.4](tech.md#34-类型感知规则未开启)）
- oxlint 1.89 的 `prefer-const` 自动修复会改坏多变量的 `let` 声明，已报给上游 [oxc#28003](https://github.com/oxc-project/oxc/issues/28003)；`scripts/format.sh` 第一遍关掉 `prefer-const`、`no-var` 绕开它，遍数不变，编辑器保存时仍会踩（2026-10-22，见 [tech.md §7](tech.md#7-已知问题prefer-const-自动修复2026-10-212026-10-22-修订)）
- 加 pre-commit 钩子，用 lint-staged 对暂存文件跑 `scripts/format.sh`，只修复和格式化，不跑测试、不拦 lint 错误（code review 指出，用户要求修复，2026-10-22，见 [tech.md §9](tech.md#9-pre-commit-钩子2026-10-22)）；加 `--no-stash`，不往各 worktree 共用的 stash 列表写备份（用户决定，2026-10-23，同上）
- `no-undef` 只对 `.js` / `.mjs` / `.cjs` 开：这些文件不经过 tsc；`simple-import-sort/exports` 没有替代，export 顺序不再检查（2026-10-22，见 [tech.md §3.1](tech.md#31-迁移时没对上的规则)）

## 文件

| 文件                               | 内容                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [tech.md](tech.md)                 | §1 选型（Oxc / Biome / 留 ESLint）；§2 根配置、三个命令、`scripts/format.sh` 的写法；§3 规则组成、迁移漏掉的规则（含 JS 文件的 `no-undef`）、React 规则、`curly` / `one-var`、类型感知；§4 oxfmt 选项、import 排序、Tailwind 排序；§5 生成文件和 Kubb；§6 VS Code 与 Claude hook；§7 `prefer-const` bug；§8 风险表；§9 pre-commit 钩子（lint-staged） |
| [plan.md](plan.md)                 | 2026-10-21 一次施工的 7 个阶段：替换、全仓库格式化、Kubb 回归（计划外）、加 `curly` / `one-var`、format 一步到位（含被否掉的脚本）、Claude hook 和 CLAUDE.md 精简、改写成模块文档；2026-10-22 按 code review 修复：共用脚本、绕开 `prefer-const` bug、pre-commit、`no-undef`、文档更正                                                                |
| [verification.md](verification.md) | `pnpm lint` 的组成；端到端检查；11 条手动验收（埋违规代码、format、React 规则、hook、pre-commit 等）；2026-10-21 和 2026-10-22 的实测耗时、依赖变化和发现的问题                                                                                                                                                                                       |

## 相关模块

- [构建与依赖](../toolchain/README.md)：类型感知规则要 TypeScript 7，可行性调研在那里；删 ESLint 时也去掉了 `pnpm-workspace.yaml` 里 `eslint@10.8.0` 的发布时间豁免。
- [文档体系](../doc-system/README.md)：`pnpm lint` 的最后一步 `pnpm docs:check`。
- [提交流程](../commit-workflow/README.md)：commitlint 管提交信息，和这里的代码检查互不相干。
