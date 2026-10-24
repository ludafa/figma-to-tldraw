# 提交流程：技术实现

> 相关：[模块说明](README.md) · [施工计划](plan.md) · [验证方案](verification.md)

## 1. 选型（2026-07-19）

需求是"给仓库加 git 提交相关能力"，参考的是一份完整的 monorepo 版本与发布指南：用 changesets 管每个包的独立版本和 changelog，`pnpm changeset publish` 发到 npm 或私有 registry，配 `/commit`、`/split-commits`、`/release` 三条 slash command。

但那份指南是为"每个包独立版本 + 发布到 registry"写的，和这个仓库对不上：

- 三个包（根、`apps/server`、`apps/client`）都是 `private: true` 的应用，也没有 `packages/*` 下要发布的包。
- changesets 会跳过 private 包的发布，`/release` 的核心 `pnpm changeset publish` 在这里是空操作。硬套会多出一套空转的机制（`.changeset/`、`/release`、配置），只增加维护面。

| 指南里的组件                                     | 结论                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `@changesets/cli` + `.changeset/config.json`     | ❌ 不装：没有发版对象                                                                  |
| `/commit`（生成 changeset + 提交）               | ✅ 改成只提交：看已暂存的改动 → 定 type 和 scope → 写 Conventional Commit → 确认后提交 |
| `/split-commits`                                 | ✅ 保留，去掉"changeset 跟着功能提交"那一条                                            |
| `/release`（升版本、写 changelog、发包、打 tag） | ❌ 不建                                                                                |
| commitlint + husky 兜底                          | ✅ 装（用户选择安装）                                                                  |

用户在"只做提交工作流"和"完整的版本发布流程"两个选项里选了前者（用户拍板）。

## 2. 钩子与配置（2026-07-19，2026-10-22 修订）

- `commitlint.config.js`（根目录，ESM）：`export default { extends: ['@commitlint/config-conventional'] };`
- husky v9：`.husky/commit-msg` 的内容是 `pnpm exec commitlint --edit "$1"`，由 husky 的 `.husky/_/commit-msg` 包装器在 commit-msg 阶段调用。
- `husky init` 顺带生成的 `pre-commit`（跑 `pnpm test`）已删除：对 starter 来说每次提交都跑全量测试太重，也会让用这个模板的人意外。

  > 2026-07-19 → 2026-10-22 修订：现在又有了 `.husky/pre-commit`，但它只用 lint-staged 修复和格式化暂存的文件，不跑测试，不到 1 秒（见 [lint-format tech.md §9](../lint-format/tech.md#9-pre-commit-钩子2026-10-22)）。

- 根 `package.json` 的 `"prepare": "husky"`：clone 之后 `pnpm install` 会自动激活钩子。CI 里如果因为 `--ignore-scripts` 之类的原因报错，设 `HUSKY=0` 关掉。
- 依赖装在根目录（`pnpm add -Dw`）：`@commitlint/cli`、`@commitlint/config-conventional`、`husky`，不装进子包。
- type 和 scope 的约定（`feat` / `fix` / `docs` / …，scope 用 `server` / `client` / `docs`）写在 CLAUDE.md「Git 提交约定」。

## 3. Slash command（2026-07-19）

| 命令                                                    | 做什么                                                                                      | 关键约束                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/commit`（`.claude/commands/commit.md`）               | 看已暂存的改动，定 type 和 scope，把拟好的提交信息给用户确认，确认后提交                    | 暂存区为空时列出改动等用户选，不自己 `git add` 全部；混了几件不相关的事时建议改用 `/split-commits`；破坏性改动要停下来确认 |
| `/split-commits`（`.claude/commands/split-commits.md`） | 把工作区的改动按逻辑分组，列出方案给用户确认，再用 `git add <file>` / `git add -p` 逐个提交 | 只处理还没推送的本地改动；hunk 拆不干净时交给用户决定，不硬拆                                                              |

两个命令共同的规矩：提交信息里不加 Claude 署名之类的尾注；被 commitlint 拦下时按报错改信息，不用 `--no-verify`；没经用户确认不提交。

## 4. 以后要发版时（2026-07-19）

- 迁移路径：装 `@changesets/cli` → `changeset init` → 补 `/release` →（发私有 registry 时）配 `access: "restricted"` 和登录态。
- 现在的 Conventional Commits 历史就是以后接 changesets 或按提交自动算版本的基础。
- 代价：`/commit` 现在不记录"改动影响哪些包、该升什么版本"。这是和"没有发版对象"相匹配的有意简化，不是缺失。
- 在 `packages/*` 放了要发布的包时，再评估要不要引入 changesets。

## 5. 风险

| 风险                                     | 应对                                                        |
| ---------------------------------------- | ----------------------------------------------------------- |
| 有人用 `--no-verify` 绕过钩子            | CLAUDE.md 和两个命令都明确禁止；没有 CI，所以没有服务端兜底 |
| CI 装依赖时 `prepare: husky` 报错        | 设 `HUSKY=0`                                                |
| 钩子靠 `pnpm exec`，没装依赖时提交会失败 | 先 `pnpm install`                                           |
