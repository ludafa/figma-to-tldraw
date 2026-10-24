# 代码规范与格式化：验证方案

> 相关：[模块说明](README.md) · [技术实现](tech.md) · [施工计划](plan.md)

## 1. 自动测试

本模块没有单测，`pnpm lint` 本身就是检查：

| 检查              | 测什么                                                   | 日期       |
| ----------------- | -------------------------------------------------------- | ---------- |
| `oxlint`          | 全部 lint 规则；warning 也算失败                         | 2026-10-21 |
| `oxfmt --check`   | 所有支持的文件都已格式化                                 | 2026-10-21 |
| `pnpm docs:check` | 文档索引和引用（见 [文档体系](../doc-system/README.md)） | 2026-10-21 |

## 2. 端到端检查

| 检查                                                          | 预期                                                                          | 日期       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------- |
| `pnpm lint`                                                   | 通过                                                                          | 2026-10-21 |
| `pnpm typecheck`                                              | 通过                                                                          | 2026-10-21 |
| `pnpm --filter @figma-to-tldraw/client build`                 | 通过；之后再跑 `pnpm lint` 不会检查 `dist/`                                   | 2026-10-21 |
| `pnpm --filter @figma-to-tldraw/client generate:api` 连跑两次 | 生成文件已格式化；第二次没有新 diff                                           | 2026-10-21 |
| `CI=true pnpm install --frozen-lockfile`                      | lockfile 一致                                                                 | 2026-10-21 |
| 在临时仓库里真实 `git commit`（pre-commit）                   | 暂存的文件已修复并格式化；没暂存的改动不进提交；`git stash list` 全程没被写入 | 2026-10-23 |

## 3. 手动验收清单

1. 在 `apps/server/src/` 新建一个文件，写 `let a = 1, b = 2;`、`if (x) return y;`、`const v: any = 1;` → `pnpm lint` 报 `one-var`、`curly`、`no-explicit-any`，退出码 1。
2. 对同一个文件跑 `pnpm format` → 声明拆开、加了 `{}`、已格式化，退出码 0；再跑 `pnpm lint` 只剩 `any` 这类修不掉的问题。
3. 在 `apps/client/src/` 写一个条件调用的 hook 和一个 `map` 里不带 `key` 的列表 → 报 `rules-of-hooks`、`jsx-key`；同样的 hook 代码放进 `apps/server/src/` → 不报 React 规则。
4. 写一行没用的 `// eslint-disable-next-line no-debugger` → 报 unused disable directive（warn，`pnpm lint` 失败）。
5. 在 `apps/client` 目录里跑 `pnpm exec oxlint` → 用的是根配置。
6. 让 Claude 写一个不规范的 TS 文件 → 落盘后已修复、已格式化（PostToolUse hook）。其中 `let a = 1, b = 2; a++;` 应该变成 `let a = 1; const b = 2;`，不能变成 `const`。
7. 让 Claude 写仓库外的文件（如 scratchpad）→ hook 不处理。
8. 在 VS Code 里打开 `figma-to-tldraw.code-workspace`，改一个 TS 文件后手动保存 → 自动修复并格式化。
9. 写 `var a = 1, b = 2; a++;` 跑 `pnpm format` → `let a = 1; const b = 2;`，`pnpm typecheck` 通过。
10. 一个文件改两处，只 `git add -p` 其中一处（故意写得不规范），`git commit` → 提交的那处已格式化；另一处还在工作区，没被提交，也没被改。
11. 在 `scripts/` 下写一个 `.mjs`，里面用拼错的 `proces` → `pnpm lint` 报 `no-undef`；同样的代码写进 `.ts` 文件不报 `no-undef`（交给 tsc）。
12. 暂存一行不规范的代码，再在同一行上做一处不暂存的改动，`git commit` → 报 `Failed to restore unstaged changes!`，提交被拦；文件里有冲突标记，`.git/lint-staged/<runId>/unstaged.patch` 存在；`git stash list` 没有新条目。

## 4. 各次实际结果

### 2026-10-21

- 迁移前基线：ESLint client 1.12 秒、server 0.65 秒（实测，各包单独跑，只覆盖 JS/TS）。
- 迁移后：`oxlint` 约 0.12 秒、`oxfmt --check` 约 0.19 秒（连跑 3 次，覆盖 81 个文件，含 JSON / YAML / Markdown / CSS / HTML；实测，Node 26.11.1）。仓库很小，耗时大头是进程启动。
- 依赖：两个 app 共删 20 个 devDependency，根目录加 `oxlint`、`oxfmt`；lockfile 净减约 1,770 行。
- 手动验收：第 1～6 条通过；第 7 条只用模拟 stdin 验证过（见下一条）；第 8 条没做（没在 VS Code 里实测）。
- hook 管道测试（模拟 stdin）：TS 违规文件被修复并格式化；Markdown 只格式化；仓库外的文件不动；被忽略的 `routeTree.gen.ts` 不动。真实触发：Write 写的 `const a = 1, b = 2` + 不带括号的 `for` / `if` 落盘后已拆开、加括号；Edit 加的 `let c = 3, d = 4` 落盘后变成两条 `const`。
- `prefer-const` 对照（实测）：同一段 `let a = 1, b = 2; a++;`，ESLint 10.8.0 `--fix` 不改动；oxlint 1.89.0 改成 `const`，运行时 `TypeError`。
- 过程中发现并处理的问题：Kubb 生成代码不再格式化（plan.md 阶段 3）；`lint:fix` 修出来的代码没格式化（阶段 4）；`prefer-const` 修复改坏代码（[tech.md §7](tech.md#7-已知问题prefer-const-自动修复2026-10-212026-10-22-修订)，已报上游）。

### 2026-10-22

- review 修复后：`pnpm lint`、`pnpm typecheck` 通过；`pnpm format` 整个仓库约 0.7 秒，退出码 0，没有产生新的改动（实测）。
- hook 管道测试（模拟 stdin）：`var a = 1, b = 2; a++; let c = 3, d = 4; c++;` 加不带括号的 `if`，落盘后是 `let a = 1; const b = 2;`、`let c = 3; const d = 4;`、`if` 加了括号，`node --experimental-strip-types` 能跑。一个文件约 0.13 秒（实测，连跑 3 次）。
- pre-commit：在临时仓库里真实提交，第 10 条通过；两个文件约 0.6～0.7 秒（实测，连跑 3 次，含 `pnpm exec` 启动）。
- 手动验收：第 6 条用 Write 真实触发通过（`var a = 1, b = 2; a++;` 加不带括号的 `if`，落盘后是 `let a = 1; const b = 2;`、`if` 加了括号）；第 9～11 条通过；第 8 条仍然没在 VS Code 里实测。
- 只传 Markdown 文件给 `scripts/format.sh`：oxlint 不报错，oxfmt 照常格式化，退出码 0。

### 2026-10-23

- pre-commit 加 `--no-stash` 前，在临时仓库里把默认模式和 `--no-stash` 各跑了四种情况：部分暂存、语法错误、没暂存的改动在相邻行、没暂存的改动在同一行。前三种结果相同；第四种默认模式会自动恢复原样，`--no-stash` 留下冲突标记和补丁文件（第 12 条），两种模式都拦下了提交。`--no-stash` 下 `git stash list` 始终为空（实测）。
- 改成 `--no-stash` 后，在临时仓库里真实提交一个不规范的文件：提交成功，内容已格式化，开头打印一行 `--no-stash` 警告（实测）。
