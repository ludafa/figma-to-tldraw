# 文档体系：技术实现

> 相关：[模块说明](README.md) · [施工计划](plan.md)

## 1. 目录结构与读法（2026-10-21）

```
apps/docs/
  README.md        # 总索引（生成，不要手改）
  <module>/
    README.md      # 模块入口：frontmatter + 概要 + 关键决定 + 文件说明
    product.md / tech.md / plan.md / verification.md / probe-*.md
```

- **三层读法**：索引 → 模块入口 → 原文。CLAUDE.md「文档」要求动手改某个功能前先读索引和对应模块的 `README.md`，按需打开原文，不整目录通读。原来的 `read-docs` skill 是"会话开始时读完 `apps/docs/` 全部文件"，文档一多就太费上下文，已删除。
- **写法规则**全在 `.claude/skills/feature-docs/SKILL.md`，各文件骨架在 `references/templates.md`，这里不重复。
- **三个命令**（根 `package.json`）：

| 命令                   | 做什么                                                         |
| ---------------------- | -------------------------------------------------------------- |
| `pnpm docs:index`      | 重写 `apps/docs/README.md`                                     |
| `pnpm docs:check-refs` | 只跑引用和链接检查（§3）                                       |
| `pnpm docs:check`      | `index.mjs --check` + `check-refs.mjs`，任何一项有问题退出码 1 |

- `pnpm lint` 最后一步是 `pnpm docs:check`。仓库没有 CI，`pnpm lint` 是唯一会被经常跑的总检查，所以并在这里。

## 2. 索引生成 `scripts/docs/index.mjs`（2026-10-21）

读每个 `apps/docs/<module>/README.md` 开头的 frontmatter，用 zod 校验，生成两张表写进 `apps/docs/README.md`：模块表（按目录名排序）和"按时间"表（日期倒序，每行列出那天施工过的模块）。思路和 skill 列表一样：索引只说每个模块管什么，读者只打开需要的那个。

### 2.1 frontmatter 格式

- 字段：`name`（必须等于目录名，`[a-z0-9-]+`）、`title`、`description`、`changes`（`YYYY-MM-DD` 数组，至少一个）、`status`（`已上线` / `开发中` / `设计中`）、`code`（可选，路径列表）。
- 只认一个很小的 YAML 子集：`key: value`、`key: [a, b]`、`- item` 列表；值两边成对的引号会去掉；CRLF 换行也能读。不支持注释，因为 `description` 里可能出现 `#`。解析器是从 ludict 原样搬来的手写实现，够用，就没引 YAML 库。
- 读不懂的行直接报错，信息带文件名和那一行：`<file>: cannot read line "…"`。

### 2.2 `code` 路径检查

- `status` 为 `已上线` 的模块，`code` 列出的路径（相对仓库根目录）必须都存在，否则报错。文件改名或删除后，这个列表不会悄悄过期。
- `设计中`、`开发中` 的模块不检查，因为列的可能是还没写的文件。
- `name` 和目录名不一致也报错。

### 2.3 输出与格式化

- 生成的 Markdown 先经 `oxfmt --stdin-filepath apps/docs/README.md` 格式化，再写入或比较。这样 `pnpm format` 和 PostToolUse hook 都不会让索引"过期"。
- ludict 原版用的是 Prettier 的 JS API；本仓库没有 Prettier，改成调 `node_modules/.bin/oxfmt` 的命令行（stdin 进、stdout 出）。oxfmt 失败时把它的 stderr 带进报错。
- `--check` 模式：生成结果和现有文件不一致就打印 `apps/docs/README.md is out of date: run pnpm docs:index`，退出码 1。

## 3. 引用与链接检查 `scripts/docs/check-refs.mjs`（2026-10-21，2026-10-22 修订）

三项检查，任何一项有问题都逐条列出位置，最后打印问题数并退出码 1；全部通过时打印 `N code references, M doc links OK`。

### 3.1 代码里的文档引用

- 用 `git grep -z -nI --untracked -E 'See apps/docs/' -- . ':!apps/docs'` 找出 `apps/docs/` 以外的所有引用：二进制和 `.gitignore` 里的文件自动跳过，还没提交的新文件也算。`git grep` 没有匹配时退出码是 1，脚本把它当成"零条结果"，不当错误。
- 两处 git 调用（这里和 §3.3 的 `git ls-files`）都带 `-z`。不带的话，git 会把中文等非 ASCII 文件名转义成 `"\344\270\255..."`，`existsSync` 找不到，这些文件被静默跳过。`-z` 让文件名原样输出，用 `\0` 分隔。
- 引用格式是 `See apps/docs/<模块>/<文件>.md §<章节>`，路径里可以有中文（正则用 `\p{L}`，不用 `\w`）。检查：文件必须存在；带 `§` 时，编号必须是数字加点（`5`、`5.2`），并且对应某个 `##`～`######` 标题开头的编号。标题编号后面要跟 `.` 或空格：`## 5. …`、`### 5.2 …` 算，`#### 7a：…` 不算。不带 `§` 的引用只检查文件存在。
- 编号末尾的标点会去掉再比较，所以注释可以写成完整的句子：`// See apps/docs/doc-system/tech.md §3.1.`

### 3.2 同一份文档里章节编号不重复

`apps/docs/` 下每个 Markdown 文件里，同一个编号只能出现一次，否则引用有歧义。典型场景：两个分支各自按"最大编号 + 1"追加了同一个 `## 8.`，合并后这里会报出来，后合并的一方改成下一个号。

### 3.3 Markdown 相对链接与锚点

- 范围是仓库里所有 `.md`（`git ls-files` 列出的已跟踪文件 + 未被忽略的新文件），不只 `apps/docs/`：CLAUDE.md、README、skill 里的链接也查。
- 目标文件必须存在。相对路径按当前文件所在目录解析；以 `/` 开头的路径和 GitHub 一样按仓库根目录解析。带 `#锚点` 时，按 GitHub 的规则（小写、去掉标点、空格变 `-`、重名加 `-1`）算出目标文件各标题的锚点，必须对得上。中文标题同样适用：`## 1. 选型（2026-10-21）` 的锚点是 `#1-选型2026-10-21`。
- 跳过：代码块和行内代码里的链接、含 `<…>` 占位符的链接、`https:` 等外部链接。
- 按标题文字生成的锚点在标题改字后会断，这项检查就是为了在 `pnpm lint` 里抓住它。
- 链接里有不完整的 `%` 转义（如 `%E0%A4%A`）时报 `malformed link`，不会让整个脚本抛异常退出。

> 2026-10-21 → 2026-10-22 修订：code review 指出三个问题（用户要求修复）：git 输出的中文文件名被转义，这些文档被静默跳过；以 `/` 开头的链接按当前目录解析，报成找不到；`decodeURI` 遇到坏的 `%` 转义直接抛异常。实测时还发现引用正则用的是 `\w`，指向中文文件名的引用根本匹配不到，一起改了。同一份文档原来会读两三次，现在读一次就缓存。

### 3.4 不在 git 仓库里时

用 degit 从模板新建项目、还没 `git init` 时，`git grep` 退出码是 128。原来脚本会抛异常，`pnpm lint` 直接失败。现在开头先跑 `git rev-parse --is-inside-work-tree`，不在 git 仓库里（或者没装 git）就打印 `check-refs: not inside a git work tree, skipped`，退出码 0，跳过全部引用和链接检查。`index.mjs` 不依赖 git，照常检查。

## 4. 代码注释约定（2026-10-21）

规则原文在 CLAUDE.md「代码注释」：功能、实现思路、设计理由、施工过程只写在 `apps/docs/` 里，代码注释只写一行 `See apps/docs/<模块>/<文件>.md §<章节>`。

- 为什么：同一件事在文档和注释里各写一份，迟早有一份过时。文档有章节、有出处、有修订记录，注释没有（用户拍板，沿用 ludict 的做法）。
- 可以留在代码里的：给工具看的指令（`oxlint-disable-next-line`、`@ts-expect-error`），后面跟一句原因；以及 `TODO(YYYY-MM-DD)`。
- 现有代码里的说明性注释不批量清理。改到哪一段，就把那一段的说明挪进对应文档，原处换成引用。这次施工按这个规则改了自己碰到的地方：`.oxlintrc.json` 的规则分组说明换成 `See apps/docs/lint-format/tech.md §3.`，`apps/client/kubb.config.ts` 的 `format: 'oxfmt'` 旁加了 `§5` 的引用，`scripts/docs/*.mjs` 只有引用。
- JSON 配置能不能写注释看工具：`.oxlintrc.json`、`.oxfmtrc.json`、`tsconfig*.json` 支持 `//`；`package.json`、`.claude/settings.json` 不支持，只能在文档里说明（如 `pnpm format` 的写法见 [lint-format tech.md §2.2](../lint-format/tech.md#22-命令)）。
- skill 里"章节编号只增不改"的规则就是为这些引用服务的。

## 5. 从 ludict 移植时改了什么（2026-10-21）

| 项目            | ludict                                         | 本仓库                                                          | 理由                                                                                                                 |
| --------------- | ---------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 文档目录        | `docs/`                                        | `apps/docs/`                                                    | 本仓库原有目录，VS Code 工作区里也单独是一个 folder                                                                  |
| 版本维度        | `versions: [v0.5]`、`（v0.3）`、`## v0.9（…）` | `changes: [2026-10-21]`、`（2026-10-21）`、`## 2026-10-21（…）` | 模板三个包都是 `0.0.0`，不发版（见根目录 `CLAUDE.md`「Git 提交约定」）；派生项目开始发版后可以改回版本号（用户拍板） |
| 索引第二张表    | 按版本                                         | 按时间（日期倒序）                                              | 同上                                                                                                                 |
| 索引格式化      | Prettier JS API                                | `oxfmt --stdin-filepath`                                        | 本仓库没有 Prettier（见 [lint-format](../lint-format/README.md)）                                                    |
| 检查入口        | CI 的 checks job                               | `pnpm lint` 最后一步                                            | 本仓库没有 CI                                                                                                        |
| 引用格式        | `See docs/…`                                   | `See apps/docs/…`                                               | 目录不同                                                                                                             |
| verification §2 | e2e 检查                                       | 端到端检查（命令或操作跑通整条流程）                            | 本仓库没有真机 e2e                                                                                                   |
| probe 头部      | macOS 版本 + Apple Silicon                     | Node、pnpm、macOS 版本                                          | 调研对象主要是 Node 工具链                                                                                           |
| 工具链类模块    | 有 product.md                                  | 可以没有 product.md，开发者看到的行为写进 tech.md               | 本仓库现有模块都是工具链，单写一份产品设计内容太少                                                                   |
| 索引标题、示例  | ludict 的名字、模块和代码                      | 本仓库的模块和代码；索引标题不带项目名                          | 派生项目跑 `rename-template` 时不用改索引脚本                                                                        |

## 6. 风险

| 风险                                                                                              | 应对                                                       |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| frontmatter 解析器只认 YAML 子集，写了多行字符串或注释会报 "cannot read line"                     | 报错带文件名和行；照 skill 骨架写就不会碰到                |
| 锚点算法是按 GitHub 规则手写的，和 VS Code 预览等其它渲染器可能有出入                             | 以 GitHub 为准，发现不一致时改脚本                         |
| 文档检查并进 `pnpm lint` 后，只改代码也可能因为文档里的 `code` 路径或引用失效而失败               | 有意为之：代码改名常常让文档失效，应该在同一个提交里一起改 |
| 不在 git 仓库里时引用和链接检查整个跳过（§3.4），degit 出来的新项目在 `git init` 之前没有这项检查 | 跳过时会打印提示；`git init` 之后自动恢复                  |
| 索引格式化依赖 `node_modules/.bin/oxfmt`，没装依赖时脚本失败                                      | 先 `pnpm install`；报错里带 oxfmt 的 stderr                |
| 同一天两个分支各自施工同一个模块，`changes` 里只有一个日期                                        | 无影响：plan.md 里两个小节都写，索引只是按天汇总           |
| 现有代码里的说明性注释和"只写引用"的规则不一致，新人可能照着旧注释的样子写                        | 规则写在 CLAUDE.md「代码注释」，改到哪挪到哪               |
