---
name: regen-api-client
description: Regenerate openapi.yml on the server and the Kubb-generated typed client on the client. Use after any change to a server route or any Zod schema with `.openapi('Name')`. Triggers when the user says "regenerate the client", "the API client is out of date", or when type errors point to missing functions in src/gen/clients.
---

# Regenerate the API client

The server's OpenAPI document is the contract. After touching server routes or named schemas, both `apps/server/openapi.yml` and `apps/client/src/gen/` must be regenerated and committed together.

## Steps

1. **Server side — emit the spec:**

   ```bash
   pnpm --filter @figma-to-tldraw/server run generate:openapi
   ```

   This runs `scripts/generate-openapi.ts`, which builds the Hono app and serializes the OpenAPI 3.1 doc into `apps/server/openapi.yml`.

2. **Client side — run Kubb:**

   ```bash
   pnpm --filter @figma-to-tldraw/client run generate:api
   ```

   Kubb reads `../server/openapi.yml` and writes:
   - `apps/client/src/gen/types/` — TypeScript types per operation/schema
   - `apps/client/src/gen/clients/` — `fetch`-based client functions
   - `apps/client/src/gen/zod/` — runtime Zod schemas

3. **Sanity check:** `pnpm typecheck`. New endpoints should appear as exports in `apps/client/src/gen/clients/index.ts`. If a function you expected is missing, double-check that the server route actually went through `createRoute` + `app.openapi(...)`, not `app.get/post(...)`.

4. **Commit `openapi.yml` and `src/gen/` together** in the same commit as the server route change. They are the same logical change.

## Common errors

- `"Cannot find module '../server/openapi.yml'"` — step 1 didn't write the file. Check for runtime errors when `generate-openapi.ts` imports `app.ts` (a broken route would show up here).
- `"Type 'X' is not assignable to type 'Y'"` after regen — the server schema changed shape. Update the client call sites.
- `getApiFoo` doesn't exist after regen — the route either isn't using `app.openapi(route, …)` or its file isn't imported from `app.ts`.
