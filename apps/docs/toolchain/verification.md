# 构建与依赖：验证方案

> 相关：[模块说明](README.md) · [技术实现](tech.md) · [可行性调研：TypeScript 7](probe-typescript-7.md) · [施工计划](plan.md)

## 1. 自动测试

本模块没有单测，靠类型检查和构建兜底（§2）。

## 2. 端到端检查

| 检查                                                        | 预期                                               | 日期       |
| ----------------------------------------------------------- | -------------------------------------------------- | ---------- |
| `pnpm --filter @figma-to-tldraw/client exec vite --version` | `vite/8.x`                                         | 2026-07-19 |
| `pnpm --filter @figma-to-tldraw/client why vite`            | 只有一个 vite 版本（server 的 vitest 也共用它）    | 2026-07-19 |
| `pnpm --filter @figma-to-tldraw/client build`               | `tsc -b && vite build` 都通过                      | 2026-07-19 |
| `pnpm --filter @figma-to-tldraw/client dev`                 | 打印 `VITE v8.x ready`，根路径和模块请求都返回 200 | 2026-07-19 |
| `CI=true pnpm install --frozen-lockfile`                    | 不报构建脚本被拦，lockfile 一致                    | 2026-07-19 |
| `pnpm typecheck`                                            | 通过                                               | 2026-10-21 |

## 3. 手动验收清单

1. `pnpm dev:server` 和 `pnpm dev:client` 都起来后打开 `http://localhost:5173/` → 登录页正常渲染，样式生效（Tailwind 在工作）。
2. 新建或改一个 `apps/client/src/routes/` 下的路由文件 → dev server 自动重写 `routeTree.gen.ts`。
3. 删掉 `node_modules` 后 `pnpm install` → `better-sqlite3` 等四个依赖的构建脚本正常执行，没有被拦下的提示。

## 4. 各次实际结果

### 2026-07-19

- `vite --version` → `vite/8.1.5`；`why vite` → "Found 1 version of vite"；client `build` 通过；client `lint` 通过（当时是 ESLint，0 warning）；`dev` → `VITE v8.1.5 ready`，根路径和模块请求都是 200。
- 手动验收：当时没有单独记录。

### 2026-10-21

- 工作区仍是 TS 6：`pnpm typecheck`、client `build` 通过。TS 7 副本里的结果见 [probe-typescript-7.md §1](probe-typescript-7.md#1-结论)。
