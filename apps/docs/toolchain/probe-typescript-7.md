# 调研：TypeScript 现在能升到最新版本吗，lint 和构建都能配合吗？

> 2026-10-21，Node 26.11.1、pnpm 11.15.0，macOS（Darwin 27.0.0）
> 起因：用户问「typescript 现在能升级到最新版本吗？要考虑到我们的整个生态(lint/build)是否都能搭配得上」。
> 这份文档只回答可行性，不做设计。要做的事已经写进 [技术实现 §3](tech.md#3-typescript-版本2026-10-21)。

## 1. 结论

**可以直接升到 7.0.2：构建、codegen、lint、提交钩子全部实测通过，没有新的 peer 冲突，要一起改的只有编辑器设置。目前只做了调研，没有升级。**

| 环节                                          | 怎么用到 `typescript`                 | 结果                                             | 耗时（TS 6 → TS 7）      |
| --------------------------------------------- | ------------------------------------- | ------------------------------------------------ | ------------------------ |
| server `tsc --noEmit`                         | 命令行                                | ✅ 没有新错误                                    | 2.53 秒 → 0.57 秒        |
| client `tsc -b`                               | 命令行（build mode）                  | ✅ 没有新错误                                    | 1.93 秒 → 0.49 秒        |
| `vite build`                                  | 不经过 tsc                            | ✅ 产物 hash 不变                                | —                        |
| `generate:openapi`（tsx）                     | 不用（esbuild）                       | ✅                                               | —                        |
| Kubb `generate:api`                           | 自带 `typescript@5.9.3`               | ✅                                               | —                        |
| drizzle-kit `generate`                        | 不用                                  | ✅ "No schema changes"                           | —                        |
| commitlint、`shadcn info`                     | 经过 cosmiconfig，但走不到 TS loader  | ✅                                               | —                        |
| oxlint 类型感知（`oxlint-tsgolint@7.0.2004`） | 要求 TS 7                             | ✅ 能抓到 `no-floating-promises`；现有代码零报错 | oxlint 0.12 秒 → 约 2 秒 |
| VS Code 内置 TypeScript                       | `typescript.tsdk` → `lib/tsserver.js` | ❌ 7.0 的包里没有这个文件                        | —                        |

耗时都是实测，同一台机器，TS 6 在工作区跑、TS 7 在副本里跑。

## 2. 怎么测的

- 环境：把仓库复制到 scratchpad（排除 `node_modules`、`.git`、`dist`），在副本里 `pnpm add -D typescript@^7.0.2` 后跑全流程，不动工作区（工作区当时有未提交的 lint 改动）。
- 判定标准：类型检查没有新错误，并且确实会报错（故意写一行 `const x: number = "nope"`，TS 7 报 `TS2322`）；构建和各个 codegen 能跑通；`pnpm peers check` 没有新问题。

## 3. 逐项结果

### 3.1 TS 7 的包里没有经典 Compiler API

`typescript@7.0.2` 的 `exports["."]` 只指向 `./lib/version.cjs`。`ts.createProgram`、`ts.factory`、`ts.transpileModule` 都没有了，只剩 `typescript/unstable/*` 下的新 API；官方说 7.1 才会带新的正式 API。所以关键问题是：依赖里谁会在运行时 `import 'typescript'`。

### 3.2 谁在运行时用 `typescript`

扫了 `node_modules/.pnpm` 下所有 `require('typescript')` / `from 'typescript'`（ESLint 相关的包当时已经删了，不算）：

| 包                                     | 怎么拿到 typescript                  | 影响                                                                                                                                                        |
| -------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kubb/fabric-core`、`@kubb/plugin-ts` | 自己的 dependency `typescript@5.9.3` | 无，和我们装的版本隔离                                                                                                                                      |
| `cosmiconfig@9.0.1`                    | 可选 peer，解析到我们装的版本        | 只在用默认 loader 加载 `.ts` 配置时才 `require`。Kubb 给 `.ts` 注册了自己的 jiti loader；commitlint 的配置是 `.js`；shadcn 只读 `components.json`。都走不到 |

另外声明了 typescript 依赖的：`msw`（可选 peer，只用类型）、`cosmiconfig-typescript-loader`（commitlint 用，只处理 `.ts` 配置）。

### 3.3 tsconfig

TS 7 删掉了 6.0 里标为废弃的选项（`baseUrl`、`moduleResolution: node10`、`target: es5`、`esModuleInterop: false` 等），也改了几个默认值（`types` 默认 `[]`、`rootDir` 默认 `./`）。我们的 tsconfig 没有用废弃选项，两个包都通过了类型检查。官方的说法是：在 6.0 下干净编译、没设 `ignoreDeprecations` 的代码，在 7.0 下结果一致。

### 3.4 编辑器

- 7.0 的包里没有 `lib/tsserver.js`，`figma-to-tldraw.code-workspace` 里的 `typescript.tsdk: node_modules/typescript/lib` 会失效。
- VS Code 要装 `TypeScriptTeam.native-preview` 扩展。官方博客说之后会内置进 VS Code，现在内置了没有，未确认。
- tsserver 插件（`compilerOptions.plugins`）和 Vue、Svelte、MDX 这类嵌入语言的工具暂时不能用 TS 7；本仓库没用到。

### 3.5 peer 依赖

`pnpm peers check` 升级前后一样，只有一条早就存在的 `@types/react` 版本提示，TS 7 没有带来新冲突。

## 4. 对设计的建议

1. 现在就能升：两个 app 的 `typescript` 改成 `^7.0.2`，删掉工作区设置里的 `typescript.tsdk`，推荐 `TypeScriptTeam.native-preview`。
2. 升了以后可以开类型感知 lint（[lint-format tech.md §3.4](../lint-format/tech.md#34-类型感知规则未开启)）。用户已经决定暂时不开（2026-10-21）。
3. 以后要引入依赖老 Compiler API 的工具时，用官方 alias 让 6 和 7 并存：`"typescript": "npm:@typescript/typescript6"` + `"@typescript/native": "npm:typescript@^7"`。
4. 调研时顺带发现 Kubb 生成的代码不再被格式化。这和 TS 无关，是删掉 Prettier 的后遗症，已经修好（[lint-format plan.md 阶段 3](../lint-format/plan.md#阶段-3kubb-生成代码没有格式化claude-发现计划外)）。
