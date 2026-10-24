---
name: bootstrap
description: First-run setup for a fresh checkout — copies env files, generates and applies the Drizzle migration, emits openapi.yml, and generates the Kubb client. Triggers on phrases like "bootstrap", "first run", "set up the project", "I just cloned this", or when commands fail because src/gen/ or routeTree.gen.ts are missing.
---

# Bootstrap

A fresh checkout has no `.env` files, no `data.db`, no `openapi.yml`, no `apps/client/src/gen/`, and no `apps/client/src/routeTree.gen.ts`. This skill walks through the minimum to get `pnpm dev:server` and `pnpm dev:client` working.

## Steps

1. **Install** if not already: `pnpm install`.
2. **Create the shared root env file:**
   - If `.env` does not exist at the repo root, run: `cp .env.example .env`.
   - The defaults (3000/5173) are fine for local dev — only edit if those ports are taken.
3. **Create the server env file:**
   - If `apps/server/.env` does not exist, run: `cp apps/server/.env.example apps/server/.env`.
   - Generate a secret: `openssl rand -base64 32`. Edit `apps/server/.env` and set `BETTER_AUTH_SECRET` to that value. Do this with the Edit tool, not by asking the user to do it.
   - Leave `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` commented out unless the user asks for GitHub OAuth.
4. **Run the bootstrap script:** `pnpm bootstrap`. This does, in order:
   - `pnpm --filter @figma-to-tldraw/server run db:generate` (drizzle reads `src/db/schema.ts` and writes `apps/server/drizzle/`)
   - `pnpm --filter @figma-to-tldraw/server run db:migrate` (creates `apps/server/data.db`)
   - `pnpm --filter @figma-to-tldraw/server run generate:openapi` (writes `apps/server/openapi.yml`)
   - `pnpm --filter @figma-to-tldraw/client run generate:api` (Kubb writes `apps/client/src/gen/`)
5. **Trigger TanStack Router code generation** for `routeTree.gen.ts`:
   - The Vite plugin generates it on dev start. Easiest way to materialize it without leaving a process running: `pnpm --filter @figma-to-tldraw/client exec vite build` once, OR briefly start `pnpm dev:client` and stop it after `routeTree.gen.ts` appears.
6. **Typecheck both apps** to confirm: `pnpm typecheck`. Resolve any errors before declaring success.

## Common errors

- `"Cannot find module './gen/clients'"` — step 4 didn't run or failed. Re-run `pnpm --filter @figma-to-tldraw/client run generate:api` and check that `apps/server/openapi.yml` exists first.
- `"Cannot find module './routeTree.gen'"` — step 5 didn't run. Start `pnpm dev:client` once.
- `"BETTER_AUTH_SECRET is not set"` — step 3 was skipped.
- Server binds to a port already in use — edit `SERVER_PORT` (and matching `SERVER_URL`) in the root `.env`.
- Drizzle `"no such table: user"` — `db:migrate` didn't run; check `apps/server/data.db` exists.

## Notes

- Two env files by design: root `.env` is shared between server and client (ports/URLs); `apps/server/.env` holds server-only secrets. Don't move secrets into the root file.
- The user may have renamed the package (`@figma-to-tldraw/*`). If `pnpm --filter @figma-to-tldraw/server …` fails, run `pnpm -r ls --depth=0` and use the actual package names.
- Don't commit `.env`, `apps/server/.env`, `data.db`, or `node_modules/`. They're already gitignored.
