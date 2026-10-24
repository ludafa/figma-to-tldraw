---
name: toolchain
title: 构建与依赖
description: client 用真正的 vite@8（自带 Rolldown 打包和 Oxc 转换，不再用 rolldown-vite 和 overrides 钉版本）；pnpm 11 的配置全部放在 pnpm-workspace.yaml（allowBuilds 构建脚本白名单、minimumReleaseAgeExclude 发布时间豁免、package.json 里 pnpm 字段已失效的教训）；packageManager 版本；TypeScript 版本（现在是 6，能不能升 7：Compiler API 被移除后哪些依赖受影响、构建和 lint 是否都能配合）。升级 Vite / pnpm / TypeScript、装依赖时报构建脚本被拦或版本太新、排查打包问题时来读。
changes: [2026-07-19, 2026-07-25, 2026-10-21]
status: 已上线
code:
  - apps/client/vite.config.ts
  - apps/client/package.json
  - pnpm-workspace.yaml
  - package.json
---

# 构建与依赖

client 用真正的 `vite@8`：Vite 8 自带 Rolldown（打包）和 Oxc（转换），所以不再需要 `rolldown-vite` 这个过渡包，也不用 overrides 钉版本。pnpm 是 11，它的配置全部写在 `pnpm-workspace.yaml`：哪些依赖允许跑安装脚本（`allowBuilds`）、哪些版本可以绕过发布时间限制（`minimumReleaseAgeExclude`）。两个 app 的 TypeScript 都是 6；Go 重写的 TypeScript 7 已经发布，2026-10-21 调研过，现有依赖都能配合，但还没升级。

## 关键决定

- client 从 `rolldown-vite@7.2.5` 迁到真正的 `vite@^8`，删掉 `rolldown-vite` 和 override（用户拍板，2026-07-19，见 [tech.md §1](tech.md#1-vite-82026-07-19)）
- pnpm 配置从 `package.json` 的 `pnpm` 字段搬到 `pnpm-workspace.yaml`：pnpm 10 起不再读那个字段，原来的 override 早就静默失效了（2026-07-19，见 [tech.md §2](tech.md#2-pnpm-11-的配置2026-07-19)）
- TypeScript 7 可以直接升，构建、codegen、lint 全部实测通过；暂不升级（2026-10-21，见 [probe-typescript-7.md](probe-typescript-7.md)）

## 文件

| 文件                                           | 内容                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [tech.md](tech.md)                             | §1 Vite 8 选型、一起升级的包、配置为什么不用改；§2 pnpm 11 的配置项和坑；§3 TypeScript 版本现状和升 7 要做的事；风险表 |
| [probe-typescript-7.md](probe-typescript-7.md) | 能不能升 TS 7：逐个环节的实测结果和耗时、谁在运行时用 `typescript`、tsconfig、编辑器、peer 依赖、建议                  |
| [plan.md](plan.md)                             | 2026-07-19 迁到 Vite 8；2026-07-25 依赖小升级；2026-10-21 TS 7 调研、去掉 eslint 的发布时间豁免                        |
| [verification.md](verification.md)             | Vite 8 迁移的检查表；手动验收；2026-07-19 和 2026-10-21 的实际结果                                                     |

## 相关模块

- [代码规范与格式化](../lint-format/README.md)：类型感知 lint 规则要 TS 7；Vite 8 用的 Oxc 和 lint 用的 Oxc 是同一个工具链。
- [提交流程](../commit-workflow/README.md)：和 Vite 8 迁移在同一个分支 `chore/vite8-migration` 上做的。
