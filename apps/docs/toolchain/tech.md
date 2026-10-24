# 构建与依赖：技术实现

> 相关：[模块说明](README.md) · [可行性调研：TypeScript 7](probe-typescript-7.md) · [施工计划](plan.md) · [验证方案](verification.md)

## 1. Vite 8（2026-07-19）

### 1.1 选型

背景：client 当时靠 devDependency 别名 `"vite": "npm:rolldown-vite@7.2.5"` 用上 Rolldown；根 `package.json` 的 `pnpm.overrides` 也钉了 rolldown-vite，但那个 override 早就失效了（§2）。需求是把 Vite / Rolldown 升到最新。

| 方案                  | 结论                                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **真正的 `vite@^8`**  | ✅ 选它。Vite 8 自带 Rolldown（打包）+ Oxc（转换）。`rolldown-vite` 是把 Rolldown 移植到 Vite 7 的过渡包，在 Vite 8 上多余；换过来不损失打包器的好处，还少一个实验性依赖和一个 override（用户拍板） |
| `rolldown-vite@7.3.1` | ❌ 中间一步曾经停在这里（最保守的升级），用户随后明确选择完整迁到 Vite 8                                                                                                                            |

### 1.2 一起升级的包

| 包                        | 之前                      | 2026-07-19 之后                      |
| ------------------------- | ------------------------- | ------------------------------------ |
| `vite`                    | `npm:rolldown-vite@7.2.5` | `^8.1.5`                             |
| `@vitejs/plugin-react`    | `^6.0.1`                  | `^6.0.3`（peer `vite@^8`）           |
| `@tailwindcss/vite`       | `^4.2.4`                  | `^4.3.3`                             |
| `tailwindcss`             | `^4.2.4`                  | `^4.3.3`（和插件保持同步）           |
| `@tanstack/router-plugin` | `^1.167.32`               | `^1.168.22`                          |
| `@tanstack/react-router`  | `^1.169.1`                | `^1.170.18`（router-plugin 的 peer） |

之后的依赖升级又把其中几个往上提了一点，当前版本以 `apps/client/package.json` 为准。

### 1.3 配置不用改

`apps/client/vite.config.ts` 只用了 `plugins`、`resolve.alias`、`server.proxy`、`define`，没有 `rollupOptions` 或 `esbuild` 选项，所以不需要改名成 `rolldownOptions` / `oxc`。迁移提交里这个文件的改动只是格式变化。排查打包问题时记住：底层是 Rolldown。

## 2. pnpm 11 的配置（2026-07-19）

- **pnpm 10 起不再读 `package.json` 里的 `pnpm` 字段**（`overrides`、`onlyBuiltDependencies` 等，见 <https://pnpm.io/settings>）。原来的 `pnpm.overrides` 一直是静默失效的，client 能用上 rolldown-vite 靠的是它自己的 devDependency 别名。这个字段已删。
- 配置全部写在 `pnpm-workspace.yaml`：
  - `allowBuilds`：允许跑安装或构建脚本的依赖，pnpm 11 用它取代 `onlyBuiltDependencies`，`pnpm approve-builds` 会改这张表。现在是 `better-sqlite3`（原生模块）、`esbuild`（平台二进制）、`msw`（worker）、`es5-ext`（postinstall），都是 `true`。
  - `minimumReleaseAgeExclude`：可以绕过 pnpm 发布时间限制的版本（pnpm 会拦下刚发布不久的版本）。现在只有 `hono@4.12.31`。`eslint@10.8.0` 是 2026-07-25 加的，2026-10-21 随 ESLint 一起删掉（见 [lint-format](../lint-format/README.md)）。本仓库没有设置 `minimumReleaseAge`，用的是 pnpm 的默认时长（具体值未确认）。
  - 原来的 `vite` override 已删，不再需要。
- 根 `package.json`：`"packageManager": "pnpm@11.15.0"`。
- 坑：在非交互环境里做需要重建 `node_modules` 的全新安装，要加 `CI=true`；改了 overrides 要加 `--no-frozen-lockfile`。

## 3. TypeScript 版本（2026-10-21）

- 两个 app 都是 `typescript@^6.0.3`。
- TypeScript 7（Go 重写，npm `latest` 是 7.0.2，2026-07-08 发布）已经调研过：可以直接升，现有依赖都能配合；还没升级。详见 [probe-typescript-7.md](probe-typescript-7.md)。
- 升级时要做的事：
  1. 两个 app 的 `typescript` 改成 `^7.0.2`。
  2. 删掉 `figma-to-tldraw.code-workspace` 里的 `typescript.tsdk` 和 `typescript.enablePromptUseWorkspaceTsdk`（7.0 的包里没有 `lib/tsserver.js`），推荐 VS Code 扩展 `TypeScriptTeam.native-preview`。
  3. 可选：开类型感知 lint（[lint-format tech.md §3.4](../lint-format/tech.md#34-类型感知规则未开启)）。

## 4. 风险

| 风险                                                                                                 | 应对                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Vite 8 / Rolldown 还新，个别插件可能不兼容                                                           | 迁移时整套 vite 相关插件都升到了 peer 支持 `vite@^8` 的版本；出问题先查插件的 peer 范围                                      |
| pnpm 配置写错地方会静默失效（`package.json` 的 `pnpm` 字段）                                         | 只在 `pnpm-workspace.yaml` 里配；改完用 `pnpm why <包>` 确认生效                                                             |
| 以后引入依赖老 Compiler API 的工具（typescript-eslint、Volar、`vite-plugin-dts` 等），升 TS 7 后会坏 | 用官方给的 alias 让 6 和 7 并存：`"typescript": "npm:@typescript/typescript6"` + `"@typescript/native": "npm:typescript@^7"` |
| 2026-07-19 时的 peer 警告（`eslint-plugin-import` 对 eslint 10 等）                                  | 2026-10-21 删掉 ESLint 后已经不存在                                                                                          |
