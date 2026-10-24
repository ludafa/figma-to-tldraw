# 登录与账号：验证方案

> 相关：[模块说明](README.md) · [技术实现](tech.md)

## 1. 自动测试

没有单测。靠 `pnpm typecheck` 和下面的手动验收。

## 2. 端到端检查

| 检查                                              | 预期                            | 日期       |
| ------------------------------------------------- | ------------------------------- | ---------- |
| 没有 cookie 的浏览器打开 `http://localhost:5173/` | 不出现登录页，直接进 Notes 首页 | 2026-10-24 |

## 3. 手动验收清单

1. 无痕窗口打开 `http://localhost:5173/` → 直接进 Notes 首页，右上角显示 `test@test.com`，没有 Sign out 按钮。
2. 在右边表单加一条笔记 → 出现在左边列表，说明 `/api/notes` 认这个会话。
3. 打开 `/login` 或 `/register` → 跳回 `/`。
4. 清掉 cookie 再打开 `/` → 还是直接进首页；`sqlite3 apps/server/data.db "select email from user;"` 只有一行 `test@test.com`（第二次走的是登录，不是又注册了一个）。

## 4. 各次实际结果

### 2026-10-24

- `pnpm typecheck`、`pnpm lint`：通过。
- 用 agent-browser 开一个全新的浏览器会话，在没有任何用户的 `data.db` 上跑完 §3 的 1～4 条，全部通过：第一次打开时自动注册（`user` 表 0 行 → 1 行）；清 cookie 后再进走的是登录（`user` 仍是 1 行，`session` 变成 2 行）；重新登录后之前加的笔记还在。
- 笔记存在 server 内存里（`apps/server/src/routes/example.ts`），测试时加的那条随 server 停掉就没了；测试账号留在了 `data.db` 里。
