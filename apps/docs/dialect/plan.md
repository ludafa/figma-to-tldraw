# 设计稿方言：施工计划

> 相关：[模块说明](README.md) · [产品设计](product.md) · [技术实现](tech.md) · [验证方案](verification.md)

## 2026-10-31（分支 `feat/figma-variables`）

起因：用户要"把 figma 数据转成 RN 方言这个事项详细展开写成 feature doc"（用户追加）。这是产品方向路线的第 3 步，也包括第 4 步里"解析代码、变回快照"的那一半（只用来检查）。今天只写了文档，下面都没开工。每个阶段做完打勾，写上日期和检查结果。

### 文档

- [x] 新建本模块：README、product.md、tech.md、plan.md、verification.md；跑字段统计（203 个用例），结果写进 tech.md §15 和 product.md §5（2026-10-31）
- [x] 产品方向的文档跟着修订：主组件"10 倍"改成按文件去重后的数、样式的值不用补导出、旋转建议用 transform；路线第 3 步指到这里（2026-10-31）

### 阶段 0：预研（先做，结果可能改设计）

- [ ] 整页重排的还原度：`/canvas` 加一个参数，导入后量所有文字、重排所有自动布局、重算组的框，`compare.ts` 跑 203 个用例，和现在比（tech.md §2）
- [ ] 41 个框对不上的组在上一条里差多少（tech.md §4.4）
- [ ] 解析器：`oxc-parser` 在 Node 和浏览器里能不能用、解析一个两千行的文件多快；不行换 `@babel/parser`（tech.md §13.1）
- [ ] 手写三个样例给用户看：一个简单屏幕、一个按钮组件集（接口 + 结构）、一个带覆盖的实例；用户定 `fg-` 的命名规则（tech.md §3.1）

### 阶段 1：骨架

- [ ] `dialect/model.ts`、`print.ts`、`parse.ts`：中间树和 TSX 互转，先只支持 `View`、`Text`、`style`、`nodeId`、`name`
- [ ] `dialect/normalize.ts`、`roundtrip.test.ts`：读 `cases/`，没有就跳过；先只比已支持的字段，不支持的字段单独计数
- [ ] `scripts/dialect.ts` 的 `import` 和 `check` 两个子命令
- [ ] 字段统计脚本 `scripts/dialect-census.ts`（tech.md §15）

### 阶段 2：布局

- [ ] 自动布局、尺寸、绝对定位和约束、组、旋转和镜像（tech.md §4）

### 阶段 3：外观

- [ ] 填充、描边、圆角、效果、透明度、混合模式、显示隐藏、蒙版、裁剪；颜色和数字的写法（tech.md §5）

### 阶段 4：文字

- [ ] 内容的写法、尺寸、样式、分段样式、按段的属性和列表（tech.md §6）

### 阶段 5：图片、矢量和资源

- [ ] `Image`、`Fg.Rect` 的图片填充；矢量的 SVG 和渲染范围；资源文件（tech.md §7）

### 阶段 6：组件和实例

- [ ] 组件接口和结构文件、属性名、`fg-bind`（tech.md §8.1）
- [ ] 实例一行、覆盖、嵌套实例、换实例、主组件不在文件里的实例（tech.md §8.2～§8.5）
- [ ] 展开实例的纯函数；缩放过的实例对着快照找规则（tech.md §8.4）

### 阶段 7：样式、变量和 tokens

- [ ] 从图层反推样式的值、tokens 文件、变量和模式（tech.md §9）

### 阶段 8：repo 结构

- [ ] 按 Figma 文件分组、主组件去重、目录和文件名、拆文件、`_index.md`、AGENTS.md、`dialect/index.d.ts`、`tsconfig.json`（tech.md §10）
- [ ] 量实际行数，更新 tech.md §10.1；必要时调拆分阈值

### 阶段 9：兜底和全量往返

- [ ] 其他字段原样写成 `fg-<字段名>`，报告里列出来（tech.md §11）
- [ ] 203 个用例逐字段零差别

### 阶段 10：验证

- [ ] 按 [verification.md](verification.md) 跑一遍，结果写进 verification.md §4；`pnpm lint`、`pnpm typecheck`、`pnpm test`
- [ ] 用户看几个生成的屏幕和组件文件
