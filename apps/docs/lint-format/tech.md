# 代码规范与格式化：技术实现

> 相关：[模块说明](README.md) · [施工计划](plan.md) · [验证方案](verification.md)

## 1. 选型（2026-10-21）

需求原话：「给我这个 seed 项目添加标准统一的一套 eslint……帮我挑选一个性能好的、容易接入的」（用户委托选型）。

原状：两个 app 各有一份几乎一样的 `eslint.config.js` + `.prettierrc`。格式化走 `eslint-plugin-prettier`，import 排序走 `eslint-plugin-simple-import-sort`，Tailwind 排序走 `prettier-plugin-tailwindcss`，每个包为这条链路装了 9～11 个 devDependency；`eslint-plugin-import` 对 eslint 10 还有 peer 警告。

| 方案                      | 结论                                                                                                                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Oxlint + Oxfmt**        | ✅ 选它。规则名就是 ESLint / typescript-eslint / react-hooks 的规则名，`@oxlint/migrate` 转换现有配置几乎没漏（§3.1），`eslint-disable` 注释照常生效；Oxfmt 自带 import 排序和 Tailwind 排序，一个工具替掉 Prettier 和两个插件；和 Vite 8 同属 Oxc 工具链 |
| Biome                     | ❌ 同样是 Rust、同样快，但规则全部改了名（`noUnusedVariables` 等），迁移和以后查规则文档都更费事；Tailwind 排序还是 nursery 阶段的 lint 规则                                                                                                              |
| 留 ESLint，抽一份共享配置 | ❌ 能解决"两份配置重复"，但慢、生态滞后                                                                                                                                                                                                                   |

版本：`oxlint ^1.89.0`、`oxfmt ^0.74.0`，都装在根目录。oxfmt 还是 0.x，`^0.74.0` 只收 patch；升 minor 时预期有少量格式变化，跑一次 `pnpm format` 单独提交。

## 2. 配置文件与命令（2026-10-21，2026-10-22 修订）

### 2.1 一份根配置

- `.oxlintrc.json`、`.oxfmtrc.json` 都在仓库根目录，覆盖所有包。子包没有 lint 配置，也没有 `lint` 脚本。
- 在子目录里运行也会用根配置：两个工具都会往上找配置文件（在 `apps/client` 里跑 `oxlint` 实测生效）。
- 两个工具都读各包自己的 `.gitignore`：`dist`、`.tanstack` 不会被检查（实测）。
- 子包专属的规则写进根配置的 `overrides`（如 `apps/client/**`），不建嵌套配置。oxlint 的嵌套配置不会自动合并，`extends` 也只继承 `rules`、`plugins`、`overrides`，容易漏掉 `env`、`ignorePatterns`。

### 2.2 命令

| 命令            | 实际执行                                     | 用途                                                |
| --------------- | -------------------------------------------- | --------------------------------------------------- |
| `pnpm lint`     | `oxlint && oxfmt --check && pnpm docs:check` | 总检查；有 warning 也失败（`options.denyWarnings`） |
| `pnpm format`   | `sh scripts/format.sh`                       | 自动修复 + 格式化，等于在编辑器里保存               |
| `pnpm lint:fix` | `pnpm format && oxlint`                      | 先 `format`，再报告剩下修不掉的问题                 |

`scripts/format.sh`（新）只有三行（都调 `node_modules/.bin/` 下的二进制，参数都带 `--no-error-on-unmatched-pattern`）：

```sh
oxlint --fix --silent -A prefer-const -A no-var "$@"
oxlint --fix --silent "$@"
oxfmt "$@"
```

不带参数时处理整个仓库，带参数时只处理传进来的文件。三个地方调用它：`pnpm format`、Claude 的 PostToolUse hook（§6.2）、pre-commit 钩子（§9）。为什么这样写：

- **格式化工具不改代码结构。** 加 `{}`、把 `let a, b` 拆成两条会改变语法树，oxfmt、Prettier、Biome 都不做，oxfmt 也没有这类选项。`curly`、`one-var` 只能靠 oxlint 的自动修复。
- **先修复，再格式化。** oxlint 的修复结果不带格式，例如 `curly` 修出来是 `{return x;}`，必须再过一遍 oxfmt。
- **两遍 `oxlint --fix`。** oxlint 每次运行时，改动范围重叠的两个修复只采用一个；ESLint 会在内部循环修复（最多 10 遍），oxlint 不会。常见的例子：`let b = 2, c = 3;` 同时触发 `prefer-const` 和 `one-var`，一遍只能修一个。两遍还能多修一层嵌套（不带括号的 `for` 里套不带括号的 `if`）；三层以上会剩下，由 `pnpm lint` 报出来。
- **第一遍关掉 `prefer-const` 和 `no-var`。** 这两条会把整条声明改成 `const` / `let`，和 `one-var` 的拆分重叠，而 `prefer-const` 改多变量声明有 bug（§7）。第一遍只拆声明、补括号，第二遍声明已经是一条一个变量，再改 `const` 就不会出错。实测：`let a = 1, b = 2; a++` 和 `var a = 1, b = 2; a++` 都修成 `let a = 1; const b = 2;`。只关 `prefer-const` 不够：`var` 那条会先被 `no-var` 改成 `let a = 1, b = 2`，第二遍照样踩 bug（实测）。
- **只看最后一步的退出码。** 还有修不掉的错误时 `oxlint --fix` 退出码非零；脚本不设 `set -e`，照样往下跑 oxfmt，整体退出码是 oxfmt 的。
- **`--no-error-on-unmatched-pattern`。** 传进来的全是 Markdown、JSON 这类 oxlint 不处理的文件时，oxlint 不报 "No files found"，oxfmt 跳过它不认识的文件。所以调用方不用按扩展名过滤。
- **是脚本，不是 `package.json` 里的一行。** 三个调用方都要传文件参数，而 `pnpm format <文件>` 的参数只会追加到最后一个命令后面。脚本要 POSIX `sh`；Windows 上要有 Git for Windows 带的 `sh`（未验证）。

> 2026-10-21 → 2026-10-22 修订：原来 `format` 是 `package.json` 里的一行 `oxlint --fix --silent; oxlint --fix --silent; oxfmt`，PostToolUse hook 里另写了一份同样的命令。code review 指出两点（用户要求修复）：两份要同步改，再加上 pre-commit 就是三份；hook 自动修复也会踩 §7 的 bug，而 Claude 只收到"文件被 hook 改过"，看不到改成了什么。所以收成一个脚本，第一遍关掉 `prefer-const`、`no-var`，遍数还是两遍。

> 2026-10-21 修订：最初 `lint:fix` 是 `oxfmt && oxlint --fix`，加了 `curly` 后修复结果没有格式化，跑完 `lint:fix` 再跑 `lint` 反而失败。中间有一版 `scripts/format.mjs`，跑 4 遍 oxlint 再格式化，并绕开 §7 的 bug；用户嫌它太绕，简化成现在的一行（过程见 [plan.md](plan.md)）。

## 3. 规则组成（2026-10-21，2026-10-22 修订）

`.oxlintrc.json`：

- `plugins`：`eslint`、`typescript`、`unicorn`、`oxc`、`import`。写了 `plugins` 就会替换默认集合，所以默认的四个也要列上。
- `categories: { "correctness": "error" }`：oxlint 的 correctness 分类，React Compiler 规则也在里面。
- 显式列出 `eslint:recommended` 和 `typescript-eslint` recommended 里不在 correctness 分类的 17 条（`no-var`、`prefer-const`、`no-empty`、`typescript/no-explicit-any` 等）。这份清单是拿 `@oxlint/migrate` 的转换结果和 correctness 规则集做差得到的（实测）。
- 沿用原 ESLint 配置的自定义规则：`no-unused-vars`（以 `_` 开头的参数和变量不报）、`typescript/ban-ts-comment`（`@ts-ignore` / `@ts-expect-error` 带说明就允许）、`import/no-duplicates`（warn）。
- `options`：`denyWarnings: true`（对应原来的 `--max-warnings 0`），`reportUnusedDisableDirectives: "warn"`。
- `env`：`builtin`、`es2022`；client override 加 `browser`，server override 加 `node`。
- 压制规则写 `// oxlint-disable-next-line <rule>`，`eslint-disable` 也认。

### 3.1 迁移时没对上的规则

`@oxlint/migrate` 转 client 配置，98 条转了过去。没转的：

| 规则                                              | 原因                                | 处理                                                                                              |
| ------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `no-undef`                                        | oxlint 里还在 nursery               | TS 文件交给 tsc，不开；`.js` / `.mjs` / `.cjs` 不经过 tsc，单独开（见下）                         |
| `no-useless-assignment`                           | oxlint 里还在 nursery               | 不开                                                                                              |
| `no-dupe-args`、`no-octal`                        | strict mode 已经禁止                | 不需要                                                                                            |
| `simple-import-sort/imports`、`prettier/prettier` | ESLint 插件                         | 由 oxfmt 接管（§4）                                                                               |
| `simple-import-sort/exports`                      | ESLint 插件                         | **没有替代**：oxfmt 只排 import、不排 export（实测），oxlint 也没有对应规则。不再检查 export 顺序 |
| `react-hooks/config`、`react-hooks/gating`        | oxlint 不开放 React Compiler 的选项 | 不需要                                                                                            |

`no-undef` 只对 JS 文件开：`.oxlintrc.json` 的最后一个 override，`files` 是 `**/*.js`、`**/*.mjs`、`**/*.cjs`，同时开 `node` 环境。仓库里的 JS 文件都是 Node 脚本（`scripts/docs/*.mjs`、`commitlint.config.js`），没有任何类型检查，拼错的变量名只能靠这条规则抓。实测：`proces.argv` 报 `'proces' is not defined`；现有文件没有误报。nursery 规则以后可能改行为，出现误报时在这里记下再关。

> 2026-10-21 → 2026-10-22 修订：原来写的是 `/exports` 也由 oxfmt 接管，实测 oxfmt 不排 export，已改正。`no-undef` 原来一律不开，理由"交给 tsc"对 JS 文件不成立（code review 指出），所以给 JS 文件单独开了。

### 3.2 React 规则（只在 client）

- `apps/client/**` override 开 `react` 插件。React Compiler 规则（`react/purity`、`react/refs`、`react/set-state-in-effect` 等）在 correctness 分类里，跟着开启。
- `react/rules-of-hooks` 不在 correctness，要显式开（error）；`react/exhaustive-deps`、`react/incompatible-library`、`react/unsupported-syntax` 是 warn，和原来的 react-hooks 插件一致。
- 在 server 里条件调用 hook 不会报错（实测），说明插件只作用于 client。

### 3.3 自定义风格规则（用户追加）

用户原话：「1. 所有 if else while for 必须用 {} 2. 变量声明必须一行一个」。

- `curly: ["error", "all"]`：`if`、`else`、`for`、`for-of`、`while`、`do` 的语句体都要 `{}`。
- `one-var: ["error", "never"]`：一条声明只声明一个变量。默认值是 `always`（要求合并），所以必须写 `never`。`for (let i = 0, n = xs.length; …)` 的初始化不受约束，和 ESLint 一致。
- 两条都能自动修复。加规则时，现有代码 `curly` 违规 12 处（3 个 client 文件），`one-var` 0 处。

### 3.4 类型感知规则未开启

- 需要 `oxlint-tsgolint`，它要求 TypeScript 7+，仓库还在 TS 6。原 ESLint 配置用的是 `recommended` 而不是带类型检查的版本，所以这里没有倒退。
- 在 TS 7 的副本里实测：能抓到 `no-floating-promises` 等；现有代码零报错；oxlint 从约 0.12 秒变成约 2 秒。用户决定先不加（用户拍板，2026-10-21）。可行性见 [toolchain/probe-typescript-7.md](../toolchain/probe-typescript-7.md)。
- 开启步骤：升 TS 7 → `pnpm add -Dw oxlint-tsgolint` → `.oxlintrc.json` 设 `options.typeAware: true`。

## 4. 格式化：oxfmt（2026-10-21）

`.oxfmtrc.json`：

- `singleQuote: true`；`printWidth: 80`（oxfmt 默认 100，这里保持原 Prettier 配置的 80）；`sortPackageJson: false`。
- oxfmt 不支持 Prettier 的 `experimentalTernaries`，三元表达式回到 Prettier 默认的写法。
- YAML override：`proseWrap: always`、`singleQuote: false`，沿用原 `.prettierrc`。
- 范围：除 JS/TS 外，JSON、YAML、Markdown、CSS、HTML 也会被格式化，并被 `oxfmt --check` 检查。原来这些文件只在 VS Code 保存时由 Prettier 处理，从没检查过。

### 4.1 import 排序

- `sortImports.groups`：`side_effect`、`builtin`、`external`、`[internal, subpath]`、`[parent, sibling, index]`、`style`、`unknown`。
- 第一组 `side_effect` 是为了复刻 simple-import-sort 的行为：副作用 import（如 `apps/client/src/main.tsx` 开头的 `import './lib/zod-error-map'`）单独成组、放在最前。加上后现有代码的 import 顺序零改动（实测）。组名是下划线 `side_effect`，写成 `side-effect` 会报 "unknown group name"。
- `@/` 开头的路径默认归 `internal` 组。

### 4.2 Tailwind class 排序

- 写在 `apps/client/**` override 里：`sortTailwindcss: { "stylesheet": "./apps/client/src/main.css", "functions": ["cn", "cva"] }`。路径相对配置文件。
- 指定 Tailwind v4 的 CSS 入口后，oxfmt 才认识 `bg-background`、`text-muted-foreground` 这些自定义 token。原来的 `prettier-plugin-tailwindcss` 没配 stylesheet，把它们当成未知 class 排到最前；切换时 class 顺序大面积变化，新顺序才是对的。

## 5. 生成文件（2026-10-21）

| 生成物                             | oxlint | oxfmt      | 说明                         |
| ---------------------------------- | ------ | ---------- | ---------------------------- |
| `apps/client/src/routeTree.gen.ts` | 忽略   | 忽略       | TanStack Router 插件每次重写 |
| `apps/server/drizzle/**`           | 忽略   | 忽略       | drizzle-kit 生成的迁移       |
| `apps/server/openapi.yml`          | —      | 忽略       | 生成脚本用 `yaml` 库输出     |
| `pnpm-lock.yaml`                   | —      | 忽略       | pnpm 管                      |
| `apps/client/src/gen/**`（Kubb）   | 忽略   | **格式化** | 见下                         |

- Kubb 的 `output.format` 默认是 `'prettier'`：生成后对 `src/gen` 跑 `prettier --write`。删掉 Prettier 后这一步静默跳过，重新生成的客户端没有分号、长行不折行、文件末尾没有换行，已提交的生成文件会出现大片 diff（2026-10-21 做 TS 7 调研时发现，计划外）。
- 修法：`apps/client/kubb.config.ts` 设 `format: 'oxfmt'`（Kubb 4.39 原生支持）。同时 `.oxfmtrc.json` **不能**忽略 `src/gen/**`：oxfmt 会跳过被忽略的路径，即使是命令行显式传进来的，那样 Kubb 这一步又成了空操作。
- Kubb 的 `output.lint` 默认 `'auto'`，会探测到 oxlint，对 `src/gen` 跑 `oxlint --fix`。`src/gen` 在 oxlint 的忽略列表里，所以这一步是空操作，生成代码不会被 `curly` 之类的规则改动（实测）。
- 新增生成物时，按上表决定加进哪份配置的 `ignorePatterns`。

## 6. 编辑器与 Claude Code（2026-10-21，2026-10-22 修订）

### 6.1 VS Code

- 一个扩展 `oxc.oxc-vscode` 同时负责 lint 和格式化，写在 `figma-to-tldraw.code-workspace` 和 `apps/client/.vscode/extensions.json` 的推荐列表里。
- 保存时先跑 `codeActionsOnSave` 的 `source.fixAll.oxc`（`explicit`：手动保存才跑），再跑 `formatOnSave`（oxfmt，`formatOnSaveMode: file`）。顺序和 `pnpm format` 一样，但只修一遍，多变量 `let` 的情况见 §7。
- 工作区是多根目录（root / server / client / docs）。按扩展说明，它会在各个 workspace folder 里找 `node_modules/.bin`，`root` 这个 folder 里有，不用配路径（未在 VS Code 里实测）。

### 6.2 Claude Code 的 PostToolUse hook

- 位置：`.claude/settings.json` 的 `hooks.PostToolUse`，匹配 `Edit|Write`。用 `jq` 取出改的那个文件，只处理 `$CLAUDE_PROJECT_DIR` 下的文件，交给 `sh scripts/format.sh "$f"`（§2.2）；输出全部静音，最后总是 `exit 0`。一个文件约 0.13 秒（实测）。
- 为什么用 hook 而不是写进 CLAUDE.md：CLAUDE.md 每次会话全量加载，风格条目越多越稀释其它指令；靠模型自觉也不如工具确定。CLAUDE.md 只保留工具管不了的约定（用户确认，2026-10-21）。精简后 CLAUDE.md 的 Tooling 一节从 380 词降到 120 词。
- hook 改了文件后，Claude Code 会提示"文件被 hook 改过"，下次编辑同一位置前要重新读文件。
- 覆盖不到的情况：通过命令行改的文件（`shadcn add`、`sed`）不会触发 hook，提交时由 pre-commit 钩子补上（§9）。hook 依赖 `jq`（macOS 自带）和 POSIX shell，Windows 上不生效。

> 2026-10-21 → 2026-10-22 修订：原来 hook 里自己写了一遍"JS/TS 扩展名跑两遍 `oxlint --fix`，再跑 `oxfmt`"，现在改成调 `scripts/format.sh`，和 `pnpm format`、pre-commit 共用一份（§2.2）。

## 7. 已知问题：prefer-const 自动修复（2026-10-21，2026-10-22 修订）

- 现象：`let a = 1, b = 2; a++;`，oxlint 1.89.0 只报 `b`（这是对的），但 `--fix` 把整条声明改成 `const a = 1, b = 2;`，运行时抛 `TypeError: Assignment to constant variable.`，tsc 报 `TS2588`。
- 对照：ESLint 10.8.0 同样只报 `b`，但不修复。它只在一条声明里每个变量都能改成 `const` 时才修。解构（`let { a, b } = o; a++;`）oxlint 处理正确，只报不修；问题只出在多变量声明上。
- 已提交上游：[oxc-project/oxc#28003](https://github.com/oxc-project/oxc/issues/28003)（2026-10-21，用户要求提交）。
- 命令行一侧已经绕开：`scripts/format.sh` 第一遍关掉 `prefer-const` 和 `no-var`，先把声明拆成一条一个变量，第二遍再改 `const`（§2.2）。`pnpm format`、Claude 的 hook、pre-commit 都走这个脚本，遍数没有增加。
- 编辑器里还会踩：VS Code 保存时只修一遍，没法先关掉某条规则。坏了 tsc 和 `no-const-assign` 会马上报错。
- 想在编辑器里彻底避开：workspace 设置加 `"oxc.lint.customization": { "prefer-const": { "autofix": false } }`。代价是保存时不再自动把 `let` 改成 `const`；这个设置的效果没有在 VS Code 里实测。
- 上游修好、升级 oxlint 后，本节改写成一行"oxlint x.y 起已修复"，编号保留；`scripts/format.sh` 第一遍的 `-A prefer-const -A no-var` 也可以去掉。

> 2026-10-21 → 2026-10-22 修订：原来决定不做绕行。理由是曾经的 `scripts/format.mjs` 为了绕开它跑了 4 遍，而编辑器照样会踩，只保护命令行意义不大（用户同意简化）。code review 指出 Claude 的 hook 自动修复也会踩，而且 Claude 看不到改成了什么；第一遍关掉两条规则不增加遍数，所以加上了。

## 8. 风险

| 风险                                                                      | 应对                                                                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| oxfmt 还是 0.x，minor 升级会改格式                                        | `^0.74.0` 只收 patch；升 minor 时单独提交 `pnpm format` 的结果                                             |
| `scripts/format.sh`、PostToolUse hook、pre-commit 都要 POSIX shell        | Windows 上要有 Git for Windows 带的 `sh`（未验证）；hook 还要 `jq`，在 Windows 上不生效                    |
| 三层以上不带括号的嵌套，两遍修复修不完                                    | `pnpm lint` 会报出来，再跑一次 `pnpm format`                                                               |
| VS Code 保存时只修一遍，`prefer-const` 仍会改坏多变量 `let`（§7）         | tsc 和 `no-const-assign` 会报错，手动改；等上游修复                                                        |
| `no-undef` 还是 nursery 规则，以后可能出误报（§3.1）                      | 出现误报时关掉，原因记进 §3.1                                                                              |
| export 顺序不再检查（§3.1）                                               | 目前没有导出很多名字的桶文件；以后需要时再找工具                                                           |
| pre-commit 只修复和格式化，不拦 lint 错误（§9）                           | 收尾时跑 `pnpm lint`（CLAUDE.md 有要求）                                                                   |
| `--no-stash` 下，没暂存的改动和格式化落在同一行时，文件留下冲突标记（§9） | 手动解决冲突；没暂存的改动在 `.git/lint-staged/<runId>/unstaged.patch` 里还有一份                          |
| 以后有人给子包建嵌套配置，规则不会自动合并                                | 约定只用根配置的 `overrides`（§2.1）                                                                       |
| VS Code 扩展在多根工作区里找二进制的行为没实测                            | 找不到时在工作区设置里配 `oxc.path.oxlint` / `oxc.path.oxfmt`（只支持绝对路径、`${userHome}`、`${env:…}`） |

## 9. pre-commit 钩子（2026-10-22）

起因：code review 指出 PostToolUse hook 只管 Claude 用 Edit / Write 改的文件，命令行改的（`shadcn add`、`sed`、codegen）和人手改的都漏掉，只能靠各个 skill 提醒跑 `pnpm format`（用户要求修复）。

- `.husky/pre-commit`（新）只有一行 `pnpm exec lint-staged --no-stash`。根 `package.json` 的配置是 `"lint-staged": { "*": "sh scripts/format.sh" }`：所有暂存的文件（新增、修改、改名，不含删除）作为参数交给 §2.2 的脚本，脚本改过的内容自动加回暂存区。
- **只修复和格式化，不跑测试，也不拦 lint 错误。** 脚本的退出码只取 oxfmt 的，`any`、未使用变量这类修不掉的问题不拦提交，仍由 `pnpm lint` 报；oxfmt 遇到语法错误会失败，这时提交被拦下，工作区恢复原样。当初删掉 `husky init` 生成的 pre-commit，是因为每次提交跑全量测试太重（见根目录 `CLAUDE.md`「Git 提交约定」）；这里只处理暂存的文件，两个文件约 0.6～0.7 秒，含 `pnpm exec` 的启动时间（实测，连跑 3 次）。
- **用 lint-staged，不自己写。** 一个文件既有暂存的改动、又有没暂存的改动时，直接格式化再 `git add` 会把没暂存的部分也提交进去。lint-staged 先把没暂存的部分存成补丁、从工作区拿掉，跑完再贴回去。实测：暂存的部分格式化后提交；没暂存的一行没被提交，留在工作区。自己写还要处理文件名里的空格和中文，比一行配置长得多。
- 版本：`lint-staged ^17.6.0`，装在根目录，3 个依赖（`tinyexec`、`picomatch`、`string-argv`），要求 Node ≥ 22.22.1。
- **不做 stash 备份（`--no-stash`）。** lint-staged 默认在开始前用 `git stash create` + `git stash store` 往 stash 列表里存一份备份，成功后删除，出错时用它恢复。这个列表是所有 worktree 共用的，而本仓库常常同时开几个 worktree、各跑一个 Claude 会话。提交被中断（Ctrl-C、进程被杀）时，备份会一直留在列表里；之后哪个 worktree 不带参数跑 `git stash pop`，就会把这个分支的改动倒进自己的分支。正常提交时备份只在列表里待约 0.6 秒，撞上的概率很小（另一个会话指出，用户决定加 `--no-stash`，2026-10-23）。
- 另一个顾虑不成立：两个 worktree 同时提交时，不会用错对方的备份。lint-staged 按 commit hash 认自己的备份，恢复用 `git stash apply <hash>`。只有清理这一步先列出 stash、再按序号删，中间有毫秒级的窗口；即使删错，删掉的也是已经用不上的备份，最坏是这次提交报错，重试即可（读 lint-staged 17.6.0 源码）。
- `--no-stash` 丢掉的只有"出错时自动恢复"（读源码，并在临时仓库里和默认模式逐项对比）：
  - 部分暂存的文件照样只提交暂存的部分。没暂存的改动另存在 `.git/lint-staged/<runId>/unstaged.patch` 里，不经过 stash。
  - 语法错误照样拦下提交，暂存区不变。
  - 没暂存的改动和被格式化的改动落在同一行时，补丁贴不回去，lint-staged 报 `Failed to restore unstaged changes!`，提交被拦。默认模式会把文件恢复成提交前的样子。`--no-stash` 下文件里会留下冲突标记（`ours` 是格式化后的暂存版本，`theirs` 是没暂存的版本），暂存区也处于冲突状态，要手动解决；没暂存的改动在上面那个补丁文件里还有一份，不会丢。Claude 改的文件落盘时已经被 hook 格式化，提交时 `scripts/format.sh` 不会再改，碰不到这种情况。
- 每次提交开头会打印 `⚠ Skipping backup because --no-stash was used. This might result in data loss.`。按上面的对比，这句对本仓库说得过重，可以忽略。
- `add-shadcn-component` skill 仍然要求装完跑 `pnpm format`：CLAUDE.md 要求收尾时跑 `pnpm lint`，不格式化的话 `oxfmt --check` 会先失败。
