# 代码规范与格式化：施工计划

> 相关：[模块说明](README.md) · [技术实现](tech.md) · [验证方案](verification.md)

## 2026-10-21（分支 `ludafa/add-oxlint-eslint-config`）

起因：用户要求「给我这个 seed 项目添加标准统一的一套 eslint。eslint 好像有很多个 alternatives，比如 oxlint？，帮我挑选一个性能好的、容易接入的」。

### 阶段 1：选型，用 Oxlint + Oxfmt 替换 ESLint + Prettier

- 文件：`.oxlintrc.json`（新）、`.oxfmtrc.json`（新）；根 `package.json`（`oxlint`、`oxfmt`，`lint` / `lint:fix` / `format` 脚本）；两个 app 的 `package.json`（删依赖和 `lint` 脚本）；删除 `apps/{server,client}/eslint.config.js` 和 `.prettierrc`；`pnpm-workspace.yaml`（`minimumReleaseAgeExclude` 去掉 `eslint@10.8.0`）；`figma-to-tldraw.code-workspace`、`apps/client/.vscode/extensions.json`；CLAUDE.md、README。
- 状态：✅ 完成（2026-10-21）
- 实际改动：先跑通现有 ESLint 作基线；用 `@oxlint/migrate` 转出两个包的配置作对照，再和 oxlint 的 correctness 规则集做差，写成 [tech.md §3](tech.md#3-规则组成2026-10-212026-10-22-修订) 的精简配置；在 client 和 server 各埋一组违规代码，确认规则生效、React 规则只作用于 client。
- 检查：迁移前 ESLint 两个包都通过；迁移后 `pnpm lint`、`pnpm typecheck`、client `pnpm build` 通过，`CI=true pnpm install --frozen-lockfile` 确认 lockfile 一致。

### 阶段 2：全仓库重新格式化

- 文件：约 35 个，主要是 client 的 UI 组件和页面，加上 Markdown、JSON、HTML。
- 状态：✅ 完成（2026-10-21）
- 实际改动：Tailwind class 顺序（[tech.md §4.2](tech.md#42-tailwind-class-排序)）、三元表达式写法、Markdown 表格对齐、JSON 数组合并成一行等。import 顺序零改动（[tech.md §4.1](tech.md#41-import-排序)）。
- 检查：`pnpm typecheck`、client `pnpm build` 通过。

### 阶段 3：Kubb 生成代码没有格式化（Claude 发现，计划外）

- 现象：做 [TS 7 调研](../toolchain/probe-typescript-7.md)时重新跑 `generate:api`，20 个生成文件全部变化（增 184 行、删 296 行）：没有分号、长行不折行、文件末尾没有换行。
- 原因：Kubb 的 `output.format` 默认用 Prettier，阶段 1 删掉 Prettier 后这一步静默跳过。和 TS 版本无关。
- 实际改动：`apps/client/kubb.config.ts` 加 `format: 'oxfmt'`；`.oxfmtrc.json` 去掉对 `apps/client/src/gen/**` 的忽略（[tech.md §5](tech.md#5-生成文件2026-10-21)）。
- 检查：重新生成后只剩 4 个文件的 import 顺序变化（项目排序规则带来的预期变化），再生成一次没有新 diff；`pnpm lint` 通过。
- 状态：✅ 完成（2026-10-21）

### 阶段 4：加 `curly` 和 `one-var`（用户追加）

- 用户原话：「我想加几个 eslint 规则：1. 所有 if else while for 必须用 {} 2. 变量声明必须一行一个」。
- 文件：`.oxlintrc.json`；`apps/client/src/lib/zod-error-map.ts`、`apps/client/src/pages/dashboard.tsx`、`apps/client/src/components/theme-toggle.tsx`。
- 状态：✅ 完成（2026-10-21）
- 实际改动：`curly` 12 处自动修复（看过完整 diff，只加了括号）；`one-var` 0 处；确认 `for` 初始化里的多变量不受约束。
- 偏差：发现当时的 `lint:fix`（`oxfmt && oxlint --fix`）修出来的 `{return x;}` 没有格式化，跑完再跑 `lint` 会失败，改成 `oxfmt && oxlint --fix && oxfmt`（后来在阶段 5 又改了）。

### 阶段 5：format 一步到位（用户追加）

- 用户原话：「能让 format 出来的也符合我刚刚的 eslint 风格要求吗？要不然看着是 format 在和 lint 在打架。」
- 文件：根 `package.json`；中间版本 `scripts/format.mjs`（已删）。
- 状态：✅ 完成（2026-10-21）
- 实际改动：
  1. 查 oxfmt 的配置项，确认没有加括号、拆声明之类的选项（格式化工具都不改语法树），只能把 oxlint 的修复串在格式化前面。
  2. 第一版写成 `scripts/format.mjs`：先 `-A prefer-const` 跑 3 遍修复，再完整跑 1 遍，最后 oxfmt。`-A prefer-const` 是为了绕开测出来的 bug（[tech.md §7](tech.md#7-已知问题prefer-const-自动修复2026-10-212026-10-22-修订)）。
  3. 用户看到脚本后说「正是因为这个问题，你才写出了这么恶心的脚本么……好家伙这个是 lint fix 了多少遍啊」（用户试用发现）。删掉脚本，换成 `package.json` 里的一行。实测只修一遍不够（重叠修复，[tech.md §2.2](tech.md#22-命令)），定为两遍。
- 偏差：`prefer-const` 的 bug 不再绕行，按用户要求提交上游 [oxc#28003](https://github.com/oxc-project/oxc/issues/28003)，提交前用 ESLint 10.8.0 做了对照确认是 oxlint 的问题。
- 检查：用一段混合了三层嵌套、多变量声明和 `any` 的代码测试，`pnpm format` 退出码 0，输出符合两条规则并已格式化；`pnpm lint` 只剩 `any`、未使用变量这类修不掉的问题。

### 阶段 6：Claude Code hook 和 CLAUDE.md 精简（用户确认）

- 起因：用户问「我在 claude.md 要求 claude 按我的编码风格写，是不是有点太浪费 claude 的注意力了？」，同意了"加 hook + 精简 CLAUDE.md"的建议。
- 文件：`.claude/settings.json`（PostToolUse hook）、CLAUDE.md（Tooling 一节）、当时的 `apps/docs/decisions/0003`（加"规则约定""Claude Code 集成"两小节）。
- 状态：✅ 完成（2026-10-21）
- 实际改动：hook 的写法见 [tech.md §6.2](tech.md#62-claude-code-的-posttooluse-hook)；CLAUDE.md 的 Tooling 一节从 380 词压到 120 词，背景信息移进 ADR（现在的本模块）。
- 检查：先用模拟的 stdin 直接测 hook 命令，再用 Write 和 Edit 各真实触发一次，结果见 [verification.md §4](verification.md#4-各次实际结果)。

### 阶段 7：改写成模块文档

- 原 `apps/docs/decisions/0003-oxlint-oxfmt-replace-eslint-prettier.md` 改写成本模块；`.oxlintrc.json` 的规则分组说明、`kubb.config.ts` 的 `format: 'oxfmt'` 改成文档引用。见 [文档体系的施工计划](../doc-system/plan.md)。
- 状态：✅ 完成（2026-10-21）

## 2026-10-22（分支 `ludafa/add-oxlint-eslint-config`）

起因：用户跑了 `/code-review high`，报出 10 条问题；逐条核实后用户要求「10 条都修复」。本模块管其中 6 条（1、4、6、7、8、9），其余 4 条是文档检查脚本的问题，记在 [文档体系的施工计划](../doc-system/plan.md)。

### 阶段 1：共用脚本，绕开 `prefer-const` 的 bug（review 第 1、8 条）

- 现象：PostToolUse hook 对 Claude 改的文件跑 `oxlint --fix`，会踩 [tech.md §7](tech.md#7-已知问题prefer-const-自动修复2026-10-212026-10-22-修订) 的 bug；Claude 只收到"文件被 hook 改过"，看不到改成了什么。同样的修复命令在 `package.json` 和 hook 里各写了一份。
- 文件：`scripts/format.sh`（新）、根 `package.json`（`format` 改成 `sh scripts/format.sh`）、`.claude/settings.json`（hook 改成调脚本，`statusMessage` 改成 `scripts/format.sh`）。
- 状态：✅ 完成（2026-10-22）
- 实际改动：第一遍 `oxlint --fix` 加 `-A prefer-const`，先测了一组：`let` 的多变量声明修对了，但 `var a = 1, b = 2; a++` 还是坏的（第一遍被 `no-var` 改成 `let a = 1, b = 2`，第二遍撞上 bug）。改成 `-A prefer-const -A no-var` 后两种都修成 `let a = 1; const b = 2;`，三层嵌套剩一处 `curly`，和原来一样。写法见 [tech.md §2.2](tech.md#22-命令)。
- 偏差：核实 review 时 Claude 原本建议第 8 条不合并，只在文档里写明两处要一起改。加上 pre-commit（阶段 2）后有了第三个调用方，而且三处都要传文件参数，就收成了脚本。

### 阶段 2：pre-commit 钩子（review 第 9 条）

- 文件：`.husky/pre-commit`（新）、根 `package.json`（`lint-staged` 配置、`lint-staged ^17.6.0`）、`pnpm-lock.yaml`。
- 状态：✅ 完成（2026-10-22）
- 实际改动：见 [tech.md §9](tech.md#9-pre-commit-钩子2026-10-22)。先比较了自己写脚本和用 lint-staged：自己写要处理部分暂存的文件和文件名里的空格、中文，选了 lint-staged。
- 检查：在 scratchpad 里建了一个临时仓库（复制配置和脚本，单独 `pnpm install`），真实 `git commit` 一次：完全暂存的文件被修复并格式化后提交；部分暂存的文件只提交了暂存的部分，没暂存的那行留在工作区；提交后 `git stash list` 为空。
- 偏差：第一次测试时临时仓库的 `node_modules` 是软链接过去的，`pnpm exec` 发现依赖和这个仓库对不上，想重新安装，于是失败。钩子失败、提交被拦，这是对的；改成单独安装后通过。

### 阶段 3：JS 文件开 `no-undef`（review 第 6 条）

- 文件：`.oxlintrc.json`（加一个 `**/*.{js,mjs,cjs}` 的 override）。
- 状态：✅ 完成（2026-10-22）
- 检查：在 `scripts/` 下放一个故意写成 `proces.argv` 的 `.mjs`，报 `no-undef`；同样的写法放在 TS 文件里不报（交给 tsc）；删掉临时文件后 `oxlint` 零报错。

### 阶段 4：改正文档（review 第 4、7 条）

- 文件：根 README（`pnpm lint` 的组成补上 `pnpm docs:check`，提到 pre-commit）、[tech.md §3.1](tech.md#31-迁移时没对上的规则)（`simple-import-sort/exports` 没有替代）、CLAUDE.md（Tooling、Git 两节各加一句 pre-commit）、本模块其余文档。
- 状态：✅ 完成（2026-10-22）
- 检查：在临时文件里写 `export { b } from './b'; export { a } from './a';`，跑 oxfmt 后顺序没变，确认 oxfmt 不排 export。

### 阶段 5：pre-commit 不用 stash 备份（review 之后补的）

- 起因：另一个会话的 agent 指出，lint-staged 的备份会写进所有 worktree 共用的 stash 列表。核实后发现：别的 worktree 不带参数 `git stash pop` 可能拿到这份备份，这一条成立；两个 worktree 同时提交会用错对方的备份，这一条基本不成立。用户决定改用 `--no-stash`。
- 文件：`.husky/pre-commit`、[tech.md §8、§9](tech.md#9-pre-commit-钩子2026-10-22)、[verification.md](verification.md)、本模块 README、CLAUDE.md（Git 一节）。
- 状态：✅ 完成（2026-10-23）
- 检查：读 lint-staged 17.6.0 的源码，确认 `--no-stash` 只关掉备份和出错时的自动恢复，隐藏没暂存的改动不受影响；然后在临时仓库里和默认模式逐项对比，结果见 [verification.md 2026-10-23](verification.md#2026-10-23)。
