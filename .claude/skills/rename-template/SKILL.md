---
name: rename-template
description: Rename the template from `hono-mono-starter` and `@hono-mono-starter/*` to a new project name. Use right after the user clones/degits the template ("rename this to <my-app>", "I just made a new project from this template, change the names").
---

# Rename the template

The string `hono-mono-starter` (and `@hono-mono-starter/*`) appears in several places. After renaming, run `pnpm install` to update the lockfile, then verify with `pnpm typecheck`.

## Steps

1. **Ask the user for the new name** (kebab-case, npm-safe). Call it `<NEW>` below. Examples: `my-app`, `acme-platform`. The scope `@<NEW>/*` will be used for workspace packages.

2. **Rewrite package names and references.** Use Edit / replace_all on these files:

   | File                                      | What to change                                                       |
   | ----------------------------------------- | -------------------------------------------------------------------- |
   | `package.json`                            | `"name": "hono-mono-starter"` → `"name": "<NEW>"`                    |
   | `apps/server/package.json`                | `"name": "@hono-mono-starter/server"` → `"name": "@<NEW>/server"`    |
   | `apps/client/package.json`                | `"name": "@hono-mono-starter/client"` → `"name": "@<NEW>/client"`    |
   | Root `package.json` scripts               | every `--filter @hono-mono-starter/...` → `--filter @<NEW>/...`      |
   | `apps/server/src/app.ts`                  | `title: 'Hono Mono Starter API'` → `'<Display Name> API'`            |
   | `apps/server/src/generate-spec.ts`        | same title change                                                    |
   | `apps/client/index.html`                  | `<title>Hono Mono Starter</title>` → `<title><Display Name></title>` |
   | `apps/client/src/layouts/auth-layout.tsx` | `Hono Mono Starter` brand string                                     |
   | `apps/client/src/layouts/app-layout.tsx`  | `Hono Mono Starter` brand string                                     |
   | `README.md`                               | top heading + every `@hono-mono-starter/*` reference                 |
   | `CLAUDE.md`                               | every `@hono-mono-starter/*` reference                               |
   | `.claude/settings.json`                   | `Bash(pnpm --filter @hono-mono-starter/* …)` patterns                |
   | `.claude/skills/*/SKILL.md`               | every `@hono-mono-starter/*` and `hono-mono-starter` mention         |

3. **Search for stragglers:**

   ```bash
   grep -rn 'hono-mono-starter' --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md' --include='*.html' --include='*.js' .
   ```

   Anything left that isn't in `node_modules`, `dist`, `.git/`, or `pnpm-lock.yaml` should be hand-checked.

4. **Refresh the lockfile:** `pnpm install`. This rewrites `pnpm-lock.yaml` with the new names.

5. **Sanity-check:** `pnpm typecheck && pnpm lint`. If lint fails on the rename alone, the new name probably has a typo.

6. **Tell the user** what changed and that they should commit the rename as a single commit before doing other work.

## Notes

- This skill is one-shot. After running it once successfully, future Claude sessions don't need it again — the template names are gone.
- Don't rename folder paths like `apps/server` and `apps/client`. Tooling assumes them.
- Don't change the SQLite filename (`data.db`). To change dev ports, edit the root `.env` (`SERVER_PORT`, `CLIENT_PORT`, and the matching `SERVER_URL` / `CLIENT_URL`) — the server, Vite proxy, and CORS all read from there.
