# CLAUDE.md

Guidance for Claude Code working in projects derived from `figma-to-tldraw`.

## What this project is

A pnpm monorepo with two apps:

- **`apps/server`** — Hono + `@hono/zod-openapi` + better-auth + Drizzle (SQLite). Source of truth for the API contract. Generates `openapi.yml`.
- **`apps/client`** — Vite 8 (Rolldown-powered) + React 19 + TanStack Router (file-based) + Tailwind v4 + shadcn/ui. Consumes the API via Kubb-generated typed clients (`src/gen/`).

Module type: ESM. Package manager: pnpm. Node imports use `.js` extensions for TS (`verbatimModuleSyntax` is on).

## 文档

设计和施工记录在 `apps/docs/`，按功能模块组织。动手改某个功能前，先看索引 `apps/docs/README.md`，再打开对应模块的 `README.md`，按需读里面的 `product.md` / `tech.md` / `plan.md` / `verification.md` / `probe-*.md`；不要整目录通读。

写或更新文档时用 `feature-docs` skill。已有章节的编号不改（代码注释靠编号引用）；新功能的章节追加在文档末尾，编号取最大编号 + 1。改了模块 `README.md` 的头部后运行 `pnpm docs:index` 重新生成索引（`pnpm lint` 会检查）。

## 代码注释

功能、实现思路、设计理由、施工过程都只写在 `apps/docs/` 里，注释里不写。同一件事如果在文档和注释里各写一份，迟早会有一份过时。

- 需要说明时，注释里只写一行指向文档的引用，格式固定为 `See apps/docs/<模块>/<文件>.md §<章节>`，例如 `// See apps/docs/lint-format/tech.md §5.`。文档里还没有这段内容，就先补进文档，再写引用。
- 以下内容可以留在代码里：给工具看的指令，例如 `oxlint-disable-next-line`、`@ts-expect-error`，后面跟一句原因；以及 `TODO(<日期>)`。
- 现有代码里已经有不少说明性注释，暂时不批量清理。改到哪一段，就把那一段的说明挪进对应文档，在原处换成引用。
- 移动或重命名文档时，用 `grep -rn "apps/docs/" apps scripts .claude *.json *.md` 找出所有引用一起改；`pnpm docs:check-refs` 会报出失效的引用和链接。

## Skills available

The `.claude/skills/` directory ships with skills for the most common tasks. Each skill describes a workflow you should follow exactly when its trigger fires. Each skill is a folder `.claude/skills/<name>/SKILL.md` with `name` + `description` frontmatter — a flat `.claude/skills/<name>.md` file is not picked up by Claude Code.

- `feature-docs` — write or update docs under `apps/docs/` (module layout, frontmatter, section numbering, writing style)
- `bootstrap` — first-run setup (env file, drizzle migrate, openapi spec, kubb client)
- `add-api-endpoint` — full server-to-client endpoint flow, including codegen refresh
- `add-db-table` — add a Drizzle table and run `db:generate` + `db:migrate`
- `add-page` — add a TanStack Router file-based page with the right layout
- `add-shadcn-component` — install a shadcn primitive into `src/components/ui/`
- `regen-api-client` — refresh `openapi.yml` and the Kubb client after server changes
- `boot-dev` — start both dev servers and verify they're up
- `rename-template` — rename `figma-to-tldraw` → `<your-app>` everywhere

## Architecture invariants

These are load-bearing — change them only with the user's explicit go-ahead.

### Server

- **Routes are defined with `createRoute(...)` from `@hono/zod-openapi`** and registered with `app.openapi(route, handler)`. Plain `app.get/post(...)` is fine for non-API endpoints (e.g. better-auth's `/api/auth/*`) but everything under `/api/<resource>/*` must go through `createRoute` so it shows up in `openapi.yml`.
- **Zod schemas exposed in the OpenAPI doc must call `.openapi('Name')`.** The string becomes the schema's name in the spec; without it, Kubb generates inline anonymous types and clients lose readability.
- **Authentication.** `requireAuth` middleware (`src/middleware/auth.ts`) reads the session via `auth.api.getSession({ headers })` and sets `c.set('userId', ...)`. Apply it to any `/api/<resource>/*` group that needs login. Routes that read `userId` should type their app as `OpenAPIHono<{ Variables: { userId: string } }>`.
- **`better-auth` tables (`user`, `session`, `account`, `verification`) are managed by better-auth.** Do not edit those table definitions — adjust only the schema's _new_ tables. If better-auth is upgraded and table shape changes, run `pnpm db:generate` and review the diff before applying.
- **`openapi.yml` is committed.** The client's Kubb codegen reads it. Anytime a route or a `.openapi('...')`-named schema changes, run `pnpm --filter @figma-to-tldraw/server generate:openapi` and commit the result alongside the server change.
- **GitHub OAuth is opt-in.** `auth.ts` only registers the GitHub provider if both `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set. The login page's "Continue with GitHub" button always renders — that's intentional; users who haven't configured it will get a clear error from better-auth on click.

### Client

- **Routes are file-based.** The TanStack Router Vite plugin rewrites `src/routeTree.gen.ts` whenever route files change. Don't hand-edit `routeTree.gen.ts`. Don't reintroduce the imperative `createRouter`/`createRoute` style.
- **Auth guards live in `_app.tsx` / `_auth.tsx`.** The client always runs as the test account `test@test.com`: `_app.tsx`'s `beforeLoad` is `ensureTestSession()` (signs in, registering the account on first use), and `_auth.tsx` redirects `/login` and `/register` to `/`. Page components do not re-check. See [`apps/docs/auth/`](apps/docs/auth/README.md).
- **API access goes through `src/gen/clients`.** Never `fetch('/api/...')` directly — Kubb-generated functions carry types and credentials. If a function you need doesn't exist, regenerate (see `regen-api-client` skill) or add the missing route on the server first.
- **Vite is real `vite@8`** — Vite 8 ships Rolldown (bundler) + Oxc (transformer) natively, so the old `rolldown-vite` package and its `overrides` pin are gone. There is no `vite` override in `pnpm-workspace.yaml` anymore; the client depends on `vite@^8` directly.
- **Tailwind v4 is CSS-first.** No `tailwind.config.*`. Theme tokens are CSS custom properties in `src/main.css`. Add new tokens under both `:root` and `.dark`.
- **`main.css` is loaded via `<link>` in `index.html`**, not via `import` from `main.tsx`. Don't change that — the cold-load FOUC story relies on it.
- **shadcn config:** `components.json` aliases `@/components`, `@/components/ui`, `@/lib/utils`, `@/hooks`. New shadcn components install into `src/components/ui/`.

### Tooling

- **Code style is automated — don't spend effort on it.** A PostToolUse hook runs `scripts/format.sh` (`oxlint --fix` + `oxfmt`) on every file you edit (formatting, import/Tailwind order, `curly`, `one-var`). `pnpm format` does the same repo-wide, and the pre-commit hook does it for staged files. Config lives only in the root `.oxlintrc.json` / `.oxfmtrc.json`; client-only rules go in the `apps/client/**` override. Rationale: [`apps/docs/lint-format/`](apps/docs/lint-format/README.md).
- **Before finishing, run `pnpm lint` and `pnpm typecheck`** and fix what's left (strict TS with `verbatimModuleSyntax`: use `import type`). Suppress a rule with `// oxlint-disable-next-line <rule>`.
- **Kubb's `src/gen/**` must stay formatted by oxfmt** (`kubb.config.ts` → `format: 'oxfmt'`); don't add it to `.oxfmtrc.json`'s `ignorePatterns`. Other codegen output (`routeTree.gen.ts`, `drizzle/**`) is ignored by both configs — add new codegen output there too.

## Git 提交约定

- **Commit message 用 [Conventional Commits](https://www.conventionalcommits.org/)。** `type(scope): subject` —— `feat` / `fix` / `docs` / `refactor` / `chore` / `test` / `build` / `ci`。scope 用受影响的包（`server` / `client` / `docs`），跨多包或全局改动可省略。一次 commit 只做一件事。
- **格式由 commitlint 机器兜底。** 根 `commitlint.config.js`（`@commitlint/config-conventional`）+ husky 的 `.husky/commit-msg` 钩子会在每次提交时校验 message，格式不对直接拦下。`.husky/pre-commit` 用 lint-staged 对暂存文件跑 `scripts/format.sh`，只修复和格式化，不跑测试；加了 `--no-stash`，不碰共用的 stash 列表，开头那行 "might result in data loss" 警告可以忽略（见 [`apps/docs/lint-format/tech.md` §9](apps/docs/lint-format/tech.md#9-pre-commit-钩子2026-10-22)）。**不要用 `--no-verify` 绕过钩子。**
- **钩子对 clone 者自动生效。** 根 `package.json` 的 `"prepare": "husky"` 在 `pnpm install` 后自动激活 husky，无需手动 `husky init`。CI 里若因 `--ignore-scripts` 报错，设 `HUSKY=0` 禁用即可。husky 属于**根** `package.json`，不装进子包。
- **版本与 changelog 暂不由提交流程管理。** 本仓库三个包都是 `private: true` 的应用，不发 registry，故**没有引入 changesets**——commit message 只影响历史可读性，不决定版本号。若将来在 `packages/*` 放要发布的包，再评估是否引入 changesets（见 [`apps/docs/commit-workflow/`](apps/docs/commit-workflow/README.md)）。
- **提交流程由 slash command 驱动：**
  - `/commit` —— 分析已 staged 的改动、确定 type/scope、写 message、提交（不自作主张 `git add` 全部）。
  - `/split-commits` —— 把攒在工作区的一坨改动拆成多个语义清晰的 commit（`git add -p` 分批 stage）。
- commit message 里**不要**加 "Generated by Claude"、co-author 之类的尾注。

## Bootstrap sequence

A fresh checkout requires:

1. `pnpm install`
2. `cp .env.example .env` (root — shared ports/URLs consumed by both apps)
3. `cp apps/server/.env.example apps/server/.env` and fill in `BETTER_AUTH_SECRET`
4. `pnpm bootstrap` (runs drizzle migrate + openapi spec + kubb codegen)
5. `pnpm dev:server` and `pnpm dev:client` in separate terminals

The `bootstrap` skill walks Claude through this and surfaces typical first-run errors.

### Env file layout

- **`<repo>/.env`** — shared values both apps need to agree on: `SERVER_PORT`, `CLIENT_PORT`, `SERVER_URL`, `CLIENT_URL`. The server loads this via `node --env-file-if-exists=../../.env`; the client reads it in `vite.config.ts` via `loadEnv(mode, '<repo root>', '')` and goes through Vite's proxy in dev (so the client uses relative `/api/*` paths). better-auth's trusted origins are derived from `CLIENT_URL` (or `CLIENT_PORT`) directly — there is no separate `TRUSTED_ORIGINS` knob.
- **`apps/server/.env`** — server-only secrets: `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID/SECRET`. Loaded after the root file so it can override shared keys if you ever need to.
- The client never reads `apps/server/.env`. Vite's bundle only exposes `VITE_*` vars, so server secrets cannot leak into the client even if the file were widened.
