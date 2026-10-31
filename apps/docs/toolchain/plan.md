# 构建与依赖：施工计划

> 相关：[模块说明](README.md) · [技术实现](tech.md) · [可行性调研：TypeScript 7](probe-typescript-7.md) · [验证方案](verification.md)

## 2026-07-19（分支 `chore/vite8-migration`，PR #1）

起因：用户要求把 Vite / rolldown 工具链升到最新。

### 阶段 1：先升到 rolldown-vite@7.3.1

- 状态：✅ 完成（2026-07-19），随后被阶段 2 取代。
- 实际改动：最保守的一步，只升 `rolldown-vite` 的小版本。用户看过结果后明确选择完整迁到 Vite 8（用户拍板）。

### 阶段 2：迁到 Vite 8，pnpm 配置搬家

- 文件：`apps/client/package.json`（vite 和相关插件）、`pnpm-workspace.yaml`（删掉 `vite` override，加 `allowBuilds`）、根 `package.json`（删掉失效的 `pnpm` 字段）、CLAUDE.md、README、`pnpm-lock.yaml`。
- 状态：✅ 完成（2026-07-19，提交 `ebcb9b2`，PR #1 合入）
- 实际改动：升级表见 [tech.md §1.2](tech.md#12-一起升级的包)。`vite.config.ts` 只有格式变化。同一个提交也升级了 server 的依赖（`hono` 4.12.31、`@hono/zod-openapi` 1.5.1、`better-auth` 1.6.23 等）。
- 检查：见 [verification.md §4](verification.md#4-各次实际结果)。

## 2026-07-25（分支 `chore/vite8-migration`，PR #2）

- client 依赖例行小升级（提交 `d98b5a5`）：react / react-dom 19.2.5 → 19.2.8、kubb 4.37 → 4.39、better-auth 1.6.9 → 1.6.25、`@types/node` 25 → 26，以及 base-ui、tanstack、lucide、shadcn 的小版本。
- `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 加 `eslint@10.8.0`，免得被 pnpm 的发布时间限制拦下。
- 同一个 PR 里还有提交流程的改动（commitlint、husky、`/commit`、`/split-commits`），规则现在写在根目录 `CLAUDE.md`「Git 提交约定」。

## 2026-10-21（分支 `ludafa/add-oxlint-eslint-config`）

### 阶段 1：TypeScript 7 可行性调研

- 状态：✅ 完成（2026-10-21）
- 实际改动：在仓库副本里试装 TS 7 跑全流程，结论和数据见 [probe-typescript-7.md](probe-typescript-7.md)。没有升级。
- 偏差：调研中发现 Kubb 生成的代码不再被格式化，在 [lint-format 施工计划阶段 3](../lint-format/plan.md#阶段-3kubb-生成代码没有格式化claude-发现计划外) 里修了。

### 阶段 2：去掉 eslint 的发布时间豁免

- 状态：✅ 完成（2026-10-21）
- 实际改动：ESLint 被 Oxlint 替换后，`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 删掉 `eslint@10.8.0`，见 [lint-format 施工计划阶段 1](../lint-format/plan.md#阶段-1选型用-oxlint--oxfmt-替换-eslint--prettier)。
