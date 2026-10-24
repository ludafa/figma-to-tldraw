---
name: auth
title: 登录与账号
description: client 统一用测试账号 test@test.com 免登录：进入 _app 下的页面时 ensureTestSession（apps/client/src/lib/auth-client.ts）自动登录，账号不存在就先注册；/login、/register 一律跳回首页；右上角去掉了 Sign out。服务端 better-auth 和 requireAuth 照旧，拿到的是真的会话。想换测试账号、恢复登录页、首页报 "Cannot sign in as test@test.com" 时来读。
changes: [2026-10-24]
status: 已上线
code:
  - apps/client/src/lib/auth-client.ts
  - apps/client/src/routes/_app.tsx
  - apps/client/src/routes/_auth.tsx
  - apps/client/src/layouts/app-layout.tsx
---

# 登录与账号

client 不再让人登录，所有人都用同一个测试账号 `test@test.com`。打开需要登录的页面时，`_app.tsx` 的 `beforeLoad` 先看有没有会话，没有就用测试账号登录；数据库里还没这个账号，就先注册（注册完自动登录）。所以全新的数据库也不用手动建账号。登录走的是 better-auth 的正常流程，浏览器拿到真的会话 cookie，服务端的 `requireAuth` 和各个 API 都不用改。登录页、注册页打不开了，会跳回首页。

## 关键决定

- 统一用 `test@test.com` 免登录（用户要求，2026-10-24）；密码 `test1234` 是自己定的，用户只给了邮箱（见 [tech.md §1](tech.md#1-测试账号自动登录2026-10-24)）
- 只改 client，没账号就由 client 注册；不在服务端建账号，也不在 `requireAuth` 里跳过会话（2026-10-24，见 [tech.md §1](tech.md#1-测试账号自动登录2026-10-24)）
- 登录页、注册页的文件先留着，只把 `_auth.tsx` 改成一律跳回首页；去掉 Sign out 按钮（2026-10-24，见 [tech.md §2](tech.md#2-登录页注册页和退出2026-10-24)）

## 文件

| 文件                               | 内容                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| [tech.md](tech.md)                 | §1 测试账号、自动登录流程、三种方案对比；§2 登录页注册页怎么关掉、为什么去掉 Sign out；§3 风险 |
| [verification.md](verification.md) | §1 自动测试（没有单测）；§2 端到端检查；§3 手动验收清单；§4 2026-10-24 的实际结果              |
