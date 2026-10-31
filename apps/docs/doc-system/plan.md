# 文档体系：施工计划

> 相关：[模块说明](README.md) · [技术实现](tech.md)

## 2026-10-21（分支 `ludafa/add-oxlint-eslint-config`）

起因：用户要求「/Users/oliver/code/ludict/.claude/skills/feature-docs 把这个 skill 集成到当前的项目里，并且用这个 skill 重写我们的 docs 文档」。

### 阶段 1：移植 skill

- 文件：`.claude/skills/feature-docs/SKILL.md`（新）、`.claude/skills/feature-docs/references/templates.md`（新）。
- 状态：✅ 完成（2026-10-21）
- 实际改动：按 [tech.md §5](tech.md#5-从-ludict-移植时改了什么2026-10-21) 的对照表改写。"版本改日期"和"注释规则一起引入"是用户在两个选项里选的（用户拍板）。
- 检查：skill 用"目录 + `SKILL.md`"的格式放好后，立刻出现在 Claude Code 的可用 skill 列表里。

### 阶段 2：移植检查脚本

- 文件：`scripts/docs/index.mjs`（新）、`scripts/docs/check-refs.mjs`（新）、根 `package.json`（`docs:index`、`docs:check-refs`、`docs:check` 三个脚本；`lint` 末尾加 `pnpm docs:check`；`zod` 加进根 devDependencies）。
- 状态：✅ 完成（2026-10-21）
- 实际改动：路径改成 `apps/docs/`；`versions` 改成 `changes` 并按日期排序；输出格式化从 Prettier 换成 oxfmt（[tech.md §2.3](tech.md#23-输出与格式化)）；脚本里的说明性注释换成 `See apps/docs/doc-system/tech.md §…` 引用；代码风格由 PostToolUse hook 统一成本仓库的（分号、`curly`）。

### 阶段 3：改写现有文档

- 文件：`apps/docs/{toolchain,commit-workflow,lint-format,doc-system}/`（新）、`apps/docs/README.md`（从写法说明改成生成的索引）；删除 `apps/docs/decisions/`。
- 状态：✅ 完成（2026-10-21）
- 原内容的去向：

| 原文件                                                                  | 去向                                                                                     |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `decisions/0001-vite-rolldown-upgrade-and-pnpm11-config.md`             | [toolchain](../toolchain/README.md)：tech.md §1～§2、plan.md 2026-07-19、verification.md |
| `decisions/0002-commit-workflow-commitlint-no-changesets.md`            | [commit-workflow](../commit-workflow/README.md)：全部                                    |
| `decisions/0003-oxlint-oxfmt-replace-eslint-prettier.md`                | [lint-format](../lint-format/README.md)：全部，并补上之后几轮的改动                      |
| 本会话的 TypeScript 7 调研（原来只在对话里）                            | [toolchain/probe-typescript-7.md](../toolchain/probe-typescript-7.md)                    |
| 原 `apps/docs/README.md`（features / solutions / decisions 的写法说明） | 被 feature-docs skill 取代                                                               |

- 偏差：ADR 只有"决定 + 后果"，改写时按 skill 拆成 tech（选型和现状）、plan（按日期的施工记录）、verification（检查和实测结果）。ADR 0002 里写的日期是 2026-07-19，实际提交 `9ee5658` 在 2026-07-25，plan.md 按开始日期 2026-07-19 记，注明合入日期。

### 阶段 4：改 CLAUDE.md 和旧 skill

- 文件：`CLAUDE.md`（新增「文档」「代码注释」两节，取代原来的 On startup 和 Documentation；Skills 列表把 `read-docs` 换成 `feature-docs`；Tooling、Git 两节里指向 ADR 的链接改成模块链接）、`.claude/skills/read-docs.md`（删除）、`.oxlintrc.json`（说明注释换成引用）、`apps/client/kubb.config.ts`（加引用）。
- 状态：✅ 完成（2026-10-21）

### 阶段 5：验证

- 状态：✅ 完成（2026-10-21）
- 检查：见下面"结果"。

结果：

- `pnpm docs:index` 生成 4 个模块的索引；再跑 `pnpm format` 后 `pnpm docs:check` 仍通过（索引已经是 oxfmt 的格式）。
- `pnpm lint` 通过（含 `pnpm docs:check`）：13 处代码引用、128 个文档链接全部对得上。`pnpm docs:check` 两个脚本合计约 0.15 秒，`pnpm lint` 整体约 0.9 秒（实测）。
- 故意改坏三处，都被报出并退出码非 0，改回后通过：`kubb.config.ts` 的引用改成 `§9` → `apps/client/kubb.config.ts:14: apps/docs/lint-format/tech.md has no section §9`；lint-format README 里一个锚点改错一位 → `has no heading for #1-选型2026-10-22`；toolchain 的 `code` 里 `pnpm-workspace.yaml` 改成 `.yml` → `code paths not found: pnpm-workspace.yml`。
- 偏差：做上面的破坏测试时，两个 `README.md` 备份到了同一个文件名，恢复时把 toolchain 的 README 写进了 lint-format；`index.mjs` 立刻报 `name "toolchain" ≠ directory`，已按原内容恢复，再测一遍通过。

### 阶段 6：其余 skill 改成目录格式（用户追加）

- 现象：项目原有的 8 个 skill（`bootstrap`、`add-api-endpoint` 等）是平铺在 `.claude/skills/` 下的单个 `.md` 文件，会话的可用 skill 列表里一个都没有；`feature-docs` 用"目录 + `SKILL.md`"放好后立刻出现。
- 原因：Claude Code 只认 `.claude/skills/<名字>/SKILL.md`，平铺的文件从来没被加载过。CLAUDE.md 列着它们，Claude 实际调不到。
- 文件：8 个 `.claude/skills/<名字>.md` 用 `git mv` 移到 `.claude/skills/<名字>/SKILL.md`，frontmatter 补 `name`；`rename-template` 里的路径通配改成 `.claude/skills/*/SKILL.md`；CLAUDE.md「Skills available」写明格式要求。
- 状态：✅ 完成（2026-10-21）
- 检查：移动后 8 个 skill 立刻全部出现在 Claude Code 的可用 skill 列表里（加上 `feature-docs` 共 9 个）。

## 2026-10-22（分支 `ludafa/add-oxlint-eslint-config`）

起因：用户跑了 `/code-review high`，核实后要求「10 条都修复」。本模块管其中 4 条（2、3、5、10）；其余 6 条记在 [代码规范与格式化的施工计划](../lint-format/plan.md)。

### 阶段 1：修 `check-refs.mjs`

- 文件：`scripts/docs/check-refs.mjs`。
- 状态：✅ 完成（2026-10-22）
- 实际改动：
  1. 第 2 条：`git grep` 和 `git ls-files` 加 `-z`，中文文件名原样输出（[tech.md §3.1](tech.md#31-代码里的文档引用)）。
  2. 第 3 条：开头先检查是不是在 git 仓库里，不是就打印提示、跳过（[tech.md §3.4](tech.md#34-不在-git-仓库里时)）。
  3. 第 5 条：以 `/` 开头的链接按仓库根目录解析；`decodeURI` / `decodeURIComponent` 抛异常时报 `malformed link`（[tech.md §3.3](tech.md#33-markdown-相对链接与锚点)）。
  4. 第 10 条：加 `textOf()` 缓存，每个文件只读一次。
- 偏差：测试时发现引用正则 `See (apps\/docs\/[\w./-]+\.md)` 匹配不到中文路径，`-z` 修好之后这类引用照样被漏掉。改成 `[\p{L}\p{N}_./-]+` 并加 `u` 标志（Claude 发现，计划外）。
- 检查：在 scratchpad 里建了一个临时目录，放一份文件名是中文的文档（`apps/docs/中文/说明.md`）和一个引用它 `§9` 的 `引用.ts`。还没 `git init` 时打印跳过提示、退出码 0；`git init` 之后报出全部 5 个问题：中文引用的 `§9` 不存在、`/nope.md` 不存在、两个坏的 `%` 转义、一个不存在的相对链接。指向 `/apps/docs/中文/说明.md#1-选型` 的根路径链接没有报错。仓库里 `pnpm docs:check` 通过。

## 2026-10-31（分支 `feat/figma-variables`）

起因：用户说文档有点乱，"所有功能、规划类的应该放到 apps/docs 里边，和项目基建相关的应该内化到项目的 claude.md 或者是 skill 里边"，先整理根目录的 `./docs`，"记录保持代码与文档的链接"（用户要求）。

### 阶段 1：根目录 `docs/`

- 文件：`docs/施工计划.md` → `apps/docs/figma-to-tldraw/plan.md`（挪过去，编号不变）；删除 `docs/handoff/` 三份交接材料，要点并进那份 plan.md 的 §9；`CLAUDE.md` 加「协作方式」和「文档」里"文档放哪"一段；改了 figma-to-tldraw 的 README、tech.md、verification.md、三份 probe 和产品方向 plan.md 里的 9 处链接。
- 状态：✅ 完成（2026-10-31）
- 检查：代码注释里本来就没有指向根目录 `docs/` 的引用；`pnpm docs:check` 372 条代码引用、412 条文档链接通过，`pnpm lint` 通过。
