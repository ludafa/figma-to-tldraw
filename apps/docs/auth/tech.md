# 登录与账号：技术实现

> 相关：[模块说明](README.md) · [验证方案](verification.md)

## 1. 测试账号自动登录（2026-10-24）

起因：用户要求「把 client 项目搞成统一用 test@test.com 账号免登录的」。

- **账号**：邮箱 `test@test.com`，密码 `test1234`，名字 `Test`，写死在 `apps/client/src/lib/auth-client.ts` 的 `TEST_USER`。用户只给了邮箱，密码是自己定的；better-auth 默认要求密码至少 8 位。
- **流程**：`apps/client/src/routes/_app.tsx` 的 `beforeLoad` 就是 `ensureTestSession()`（定义在 `auth-client.ts`），每次进入 `_app` 下的页面都会跑：
  1. `authClient.getSession()` 有会话 → 直接放行。
  2. 没有 → `authClient.signIn.email` 用测试账号登录，成功就放行。
  3. 登录失败（数据库里还没这个账号）→ `authClient.signUp.email` 注册。better-auth 的 `autoSignIn` 默认开着，注册成功同时就登录了。
  4. 注册也失败 → 抛错 `Cannot sign in as test@test.com: <原因>`，TanStack Router 显示默认错误页。
- 登录拿到的是真的 better-auth 会话 cookie。服务端 `apps/server/src/middleware/auth.ts` 的 `requireAuth`、`/api/notes` 等接口都不知道"免登录"这回事，照常按会话认人。
- `/canvas` 不在 `_app` 下面，本来就不需要登录，这次没变。

| 方案                                                  | 结论                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| client 自动登录，没账号就由 client 注册               | ✅ 只改 client，服务端认证链路原样；全新数据库第一次打开就能用                                           |
| 服务端启动时建好账号，client 只负责登录               | ❌ 要在 server 加一段建账号的代码；client 照样得写死密码，好处不大                                       |
| 服务端 `requireAuth` 直接把请求当成测试用户，不看会话 | ❌ 改了 CLAUDE.md 里服务端的认证约定；client 的 `authClient.useSession()` 拿不到用户，右上角显示不了邮箱 |

## 2. 登录页、注册页和退出（2026-10-24）

- `apps/client/src/routes/_auth.tsx` 的 `beforeLoad` 一律 `redirect` 到 `/`，`/login`、`/register` 打不开了。原来是"已登录才跳回首页"，现在不看登没登录都跳，因为要登录的页面自己会登录。

  > 2026-10-24 → 2026-10-31 修订：原来 `/` 是 Notes 示例，"跳回首页"等于进 Notes 并自动登录；现在 `/` 是不用登录的首页，Notes 挪到了 `/notes`（§4）。跳到 `/` 照样没问题。

- 页面文件 `apps/client/src/pages/login.tsx`、`pages/register.tsx`、`layouts/auth-layout.tsx` 先留着。想恢复登录页：把 `_auth.tsx` 的 `beforeLoad` 改回"有会话才跳"，再把 `_app.tsx` 改回"没会话就跳 `/login`"。
- `apps/client/src/layouts/app-layout.tsx` 去掉了 Sign out 按钮：退出后一回首页又会自动登录，按钮点了等于没点。右上角仍显示当前邮箱。

## 3. 风险

| 风险                                                                          | 应对                                                                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 密码写在前端代码里，打包后谁都能看到                                          | 这是 Demo 用的测试账号，不放真实数据。要给别人部署时，按 §2 恢复登录页，去掉 `TEST_USER`                                                           |
| 数据库里已经有 `test@test.com`，但密码不是 `test1234`（比如以前用注册页建过） | 登录、注册都失败，`/notes` 报 `Cannot sign in as test@test.com`。把 `TEST_USER.password` 改成那个密码，或者在 `apps/server/data.db` 里删掉这个用户 |
| 全新数据库，同时开两个标签页，两边同时注册                                    | 后到的那边注册报"用户已存在"，进错误页，刷新一下就走登录了。没做去重，Demo 里不值得                                                                |

## 4. Notes 示例挪到 /notes（2026-10-31）

用户要一个把所有页面收拢起来的首页（用户追加），首页放在 `/`（`apps/client/src/routes/index.tsx`，见 [产品方向 tech.md §4](../product-direction/tech.md#4-首页-2026-10-31)）。它不在 `_app` 下面，不用登录，没有服务端也能打开。

`/` 原来是模板自带的 Notes 示例（`apps/client/src/routes/_app/index.tsx` → `pages/dashboard.tsx`），路由文件改名成 `routes/_app/notes.tsx`，地址变成 `/notes`。它还在 `_app` 下面，打开时照旧自动登录测试账号，§1 的流程不变。
