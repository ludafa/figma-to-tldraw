# 提交流程：验证方案

> 相关：[模块说明](README.md) · [技术实现](tech.md) · [施工计划](plan.md)

## 1. 自动测试

本模块没有单测，规则由 `@commitlint/config-conventional` 提供。

## 2. 端到端检查

| 检查                                                                     | 预期                                         | 日期       |
| ------------------------------------------------------------------------ | -------------------------------------------- | ---------- |
| `echo "added some stuff" \| pnpm exec commitlint`                        | 退出码 1，报 `type-empty` 和 `subject-empty` | 2026-07-19 |
| `echo "feat(server): add health check endpoint" \| pnpm exec commitlint` | 退出码 0                                     | 2026-07-19 |

## 3. 手动验收清单

1. `git commit -m "bad"` → 被钩子拦下，打印 commitlint 的报错。
2. `git commit -m "docs: fix typo"` → 正常提交。
3. 新 clone 一份仓库，`pnpm install` 后直接提交一条不合规的信息 → 被拦下（钩子是自动激活的）。
4. 在 Claude Code 里暂存区为空时跑 `/commit` → Claude 列出未暂存的改动等你选，不自己 `git add`。

## 4. 各次实际结果

### 2026-07-19

- 不合规的信息退出码 1（`type-empty`、`subject-empty`），合规的信息退出码 0。
- 手动验收：当时没有单独记录。

### 2026-10-21

- 在 TS 7 调研的仓库副本里复测：`feat(server): probe` 通过，`bad msg` 退出码 1（[toolchain 的调研](../toolchain/probe-typescript-7.md)）。
