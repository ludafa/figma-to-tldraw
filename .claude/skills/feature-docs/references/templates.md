# 文档骨架

把 `<…>` 换成实际内容。章节是常见结构，没内容的删掉，不要留空标题。真实样例见 `apps/docs/lint-format/`（完整模块）、`apps/docs/toolchain/`（含调研）、`apps/docs/doc-system/`（只有 README + tech + plan 的小模块）。

## README.md（模块入口）

```markdown
---
name: <目录名>
title: <中文名，2～8 个字>
description: <管什么 + 什么时候该来读，带关键名词>
changes: [YYYY-MM-DD]
status: 设计中
code:
  - apps/<…>/
---

# <中文名>

<概要 3～6 句：现在能做什么，核心机制是什么。>

## 关键决定

- <一句结论>（YYYY-MM-DD，见 [tech.md §1](tech.md#1-选型yyyy-mm-dd)）

## 文件

| 文件                               | 内容                         |
| ---------------------------------- | ---------------------------- |
| [product.md](product.md)           | <各章节讲什么>               |
| [tech.md](tech.md)                 | <…>                          |
| [plan.md](plan.md)                 | <有哪几次施工、每次做了什么> |
| [verification.md](verification.md) | <…>                          |

## 相关模块

- [<中文名>](../<module>/README.md)：<关系>
```

## probe-<主题>.md

```markdown
# 调研：<要回答的问题，用问句>

> YYYY-MM-DD，Node <版本>、pnpm <版本>，macOS <版本>
> 起因：用户问「<原话>」。
> 这份文档只回答可行性，不做设计。结论落地后写进 [技术实现](tech.md)。

## 1. 结论

**<一句话结论>**

| <对象> | <能力 A> | <能力 B> | 结果 | 耗时 |
| ------ | -------- | -------- | ---- | ---- |

## 2. 怎么测的

- 环境：<在哪测的，如"把仓库复制到临时目录试装，不动工作区">
- 判定标准：<怎样算成功>

## 3. 逐项结果

## 4. 对设计的建议
```

## product.md

```markdown
# <中文名>：产品设计

> 相关：[模块说明](README.md) · [技术实现](tech.md) · [施工计划](plan.md) · [验证方案](verification.md)
> 界面原型：<链接>（<评审状态>）

## 1. 要解决的问题

<用户的真实场景。现在是什么样、哪里不方便。>

## 2. <行为 A>（YYYY-MM-DD）

<界面从上到下 / 操作步骤 / 默认值 / 文案。用户拍板的地方标（用户拍板）。>

## 3. <行为 B>（YYYY-MM-DD）

## 4. 范围与非目标

**范围：**§2～§3。

**非目标：**<明确不做的>。

## 5. 成功标准

1. <可手动验证：做什么 → 看到什么>
```

## tech.md

```markdown
# <中文名>：技术实现

> 相关：[模块说明](README.md) · [产品设计](product.md) · [施工计划](plan.md) · [验证方案](verification.md)

## 1. 选型（YYYY-MM-DD）

| 方案     | 结论            |
| -------- | --------------- |
| <方案 A> | ✅ 推荐：<理由> |
| <方案 B> | ❌ <理由>       |

## 2. <部分>（<位置，如 服务端 `apps/server/src/xxx/`>）（YYYY-MM-DD）

## 3. 数据与接口（YYYY-MM-DD）

<zod schema（`.openapi('Name')`）、API 路由（`createRoute`）、Drizzle 表与迁移、环境变量及默认值>

## 4. 与现有代码的关系

## 5. 风险

| 风险 | 应对 |
| ---- | ---- |
```

## plan.md

```markdown
# <中文名>：施工计划

> 相关：[模块说明](README.md) · [产品设计](product.md) · [技术实现](tech.md) · [验证方案](verification.md)

## YYYY-MM-DD（分支 `<分支名>`）

### 阶段 0：预研

- 要回答：<实测的问题>
- 状态：⬜ 未开始

### 阶段 1：<名称>

- 文件：`apps/…/a.ts`（新）、`apps/…/b.ts` + 测试。
- 状态：⬜ 未开始

### 阶段 N：验证方案
```

## verification.md

```markdown
# <中文名>：验证方案

> 相关：[模块说明](README.md) · …

## 1. 自动测试

| 测试文件 | 测什么 | 日期 |
| -------- | ------ | ---- |

## 2. 端到端检查

| 检查 | 预期 | 日期 |
| ---- | ---- | ---- |

## 3. 手动验收清单

1. <操作> → <应该看到什么>

## 4. 各次实际结果

### YYYY-MM-DD

- 本机：<日期>，`pnpm lint` / `pnpm typecheck` / `pnpm test`（N 个文件 M 条）/ `pnpm build` 的结果；实测耗时 …。
- 手动验收：第 x 条 …；其余待做。
```
