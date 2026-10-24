# 提交流程：施工计划

> 相关：[模块说明](README.md) · [技术实现](tech.md) · [验证方案](verification.md)

## 2026-07-19（分支 `chore/vite8-migration`，PR #2 于 2026-07-25 合入）

起因：用户要求"给仓库加 git 提交相关能力"，附了一份完整的 monorepo 版本与发布指南。

### 阶段 1：定范围

- 状态：✅ 完成（2026-07-19）
- 实际改动：对照仓库现状，列出指南里每个组件要不要；用户选了"只做提交工作流"，并选择安装 commitlint + husky（用户拍板）。结论见 [tech.md §1](tech.md#1-选型2026-07-19)。

### 阶段 2：commitlint + husky

- 文件：`commitlint.config.js`（新）、`.husky/commit-msg`（新）、根 `package.json`（devDependencies、`prepare`）、`pnpm-lock.yaml`。
- 状态：✅ 完成（提交 `9ee5658`，2026-07-25）
- 偏差：删掉了 `husky init` 生成的 `pre-commit` 钩子（[tech.md §2](tech.md#2-钩子与配置2026-07-192026-10-22-修订)）。

### 阶段 3：slash command 和文档

- 文件：`.claude/commands/commit.md`（新）、`.claude/commands/split-commits.md`（新）、CLAUDE.md「Git 提交约定」、ADR `apps/docs/decisions/0002`（2026-10-21 改写成本模块，见 [文档体系的施工计划](../doc-system/plan.md)）。
- 状态：✅ 完成（2026-07-25）
- 检查：见 [verification.md §4](verification.md#4-各次实际结果)。

## 2026-10-22（分支 `ludafa/add-oxlint-eslint-config`）

加了只格式化暂存文件的 `.husky/pre-commit`（lint-staged），施工记录在 [代码规范与格式化的施工计划](../lint-format/plan.md)。
