# 产品方向和计划：施工计划

> 相关：[模块说明](README.md) · [产品设计](product.md) · [技术实现](tech.md) · [调研：可交互设计稿的手工编辑](probe-interactive-editing.md)

## 2026-10-31（分支 `feat/figma-variables`）

起因：2026-10-30 评审了用户写的方案 `tmp/interactive-plan.md`，用户说明了目标（迁到自研产品、不回 Figma）、拍板代码优先，又让我调研可交互设计稿的手工编辑；2026-10-31 用户要"在 client 项目里做一个页面，来详细介绍我们现在的目标和计划"（用户追加）。

### 阶段 1：整理文档

- [x] 新建本模块：README、product.md（目标、决定、数据、修正、转换、交互、要补的、待定）、probe-interactive-editing.md、tech.md、plan.md（2026-10-31）

### 阶段 2：介绍页 `/roadmap`

- [x] `apps/client/src/pages/roadmap.tsx`（新）、`apps/client/src/routes/roadmap.tsx`（新），见 tech.md §1（2026-10-31）
- [x] `pnpm lint`、`pnpm typecheck` 通过，浏览器里打开看过（2026-10-31）

### 阶段 3：首页 `/`（用户追加）

- [x] `apps/client/src/pages/home.tsx`（新）、`apps/client/src/routes/index.tsx`（新），见 tech.md §4（2026-10-31）
- [x] Notes 示例 `routes/_app/index.tsx` 改名成 `routes/_app/notes.tsx`，地址 `/notes`；登录模块的文档跟着改（auth tech.md §4）（2026-10-31）
- [x] `/roadmap` 顶部导航加"首页"（2026-10-31）
- [ ] 线上 `/` 显示首页：删掉 `export-static.ts` 里 `/` 跳 `/showcase` 的配置，等另一个会话提交了这个文件再改

## 路线（2026-10-30 讨论，都没开工，顺序是建议、用户未确认）

和 `/roadmap` 页面的 `STEPS` 一一对应，开工后两边一起改。

- [ ] 1. 补全导入：插件导出矢量的路径数据、样式的值，导整份文件的所有页面和团队库（product.md §8 第 1、3、4 条）
- [ ] 2. 渲染不靠 Figma：矢量按几何数据画（[figma-to-tldraw plan.md](../figma-to-tldraw/plan.md) 第 9 步第 5 条）、图片滤镜自己算（figma-to-tldraw tech.md §22）；现有用例还原度不下降
- [ ] 3. Figma → 代码：从快照生成方言 repo，覆盖按 id，组件拆成接口和变体（product.md §5）。详细设计和施工计划在 [设计稿方言](../dialect/README.md)（2026-10-31 写好文档，没开工）；不依赖第 1、2 步，可以先做
- [ ] 4. 代码 → JSON：解析求值，每个节点带源码位置；生成再求值，和快照逐字段一致、画出来逐像素一样（product.md §6）
- [ ] 5. 画布改动 → 代码：每种编辑操作变成最小的源码补丁，满足 product.md §6 的五条
- [ ] 6. agent 任务对比：同样的任务给原始 JSON 和给代码，比改对率和 token（product.md §11 第 4 条）
- [ ] 7. 可交互的最小验证切片：`variables/*` 用例 + 演示模式 + 三种编辑模式（probe-interactive-editing.md §4 第 4 条）
