---
name: add-api-endpoint
description: Add a new HTTP endpoint to the server, expose it in OpenAPI, and refresh the typed client. Use when the user asks to "add an endpoint", "add a route", "expose X over the API", or to add CRUD for a resource.
---

# Add an API endpoint

Endpoints are defined with `createRoute` from `@hono/zod-openapi`, registered with `app.openapi(...)`, mounted from `app.ts`, and consumed on the client via Kubb-generated functions.

## Steps

1. **Decide if the endpoint is auth-gated.** If yes, the resource group must call `app.use('/api/<resource>/*', requireAuth)` and the app must be typed `OpenAPIHono<{ Variables: { userId: string } }>`. See `src/routes/example.ts` for the canonical pattern.

2. **Pick / create a route file:**
   - For a new resource, create `apps/server/src/routes/<resource>.ts`.
   - For an additional endpoint on an existing resource, edit that file.

3. **Define request and response Zod schemas.**
   - Inline schemas are fine for one-off shapes.
   - For shapes that show up in the OpenAPI doc, append `.openapi('PascalCaseName')` so Kubb generates a named TypeScript type.
   - Reuse `ErrorSchema` and `PaginationSchema` from `src/schemas/api.ts`.

4. **Define the route with `createRoute`:** include `method`, `path`, `tags`, `summary`, optional `request: { params, query, body }`, and `responses` keyed by status code. Always include a `401` entry when the route is auth-gated, and `404` for path params that may miss.

5. **Register the handler with `app.openapi(route, (c) => …)`:** read inputs via `c.req.valid('json'|'param'|'query')`, read `userId` via `c.get('userId')`, return with the matching `c.json(payload, status)` shape.

6. **Mount the resource app in `apps/server/src/app.ts`** if it's a new file: `app.route('/', <resource>App)`.

7. **Regenerate the OpenAPI spec and Kubb client:**
   - `pnpm --filter @figma-to-tldraw/server run generate:openapi`
   - `pnpm --filter @figma-to-tldraw/client run generate:api`
   - Or run both via the `regen-api-client` skill.

8. **Typecheck:** `pnpm typecheck`. New client functions in `apps/client/src/gen/clients/` and types in `apps/client/src/gen/types/` should now exist.

9. **(Optional) Use it in a page** by importing from `'@/gen/clients'` (or relative path).

## Conventions

- **One route file per resource.** Name it after the resource in the URL path: `/api/notes` → `routes/notes.ts`, `/api/users/:id/posts` → `routes/posts.ts`.
- **`tags`** group endpoints in Swagger UI — keep them title-cased and consistent across a resource.
- **Status codes** in `responses` are the wire contract; match them in the handler. `c.json(x, 201)` requires `responses: { 201: ... }`.
- **Don't import server code from the client.** If the client needs a type, regenerate so it comes through Kubb.

## Don'ts

- Don't add `app.get/post(...)` for `/api/*` routes — they won't show up in OpenAPI and clients will lose typing.
- Don't bypass `requireAuth` to "make it easier" for a route that mutates user-scoped data. Check the existing pattern in `routes/example.ts`.
- Don't commit `openapi.yml` and the regenerated `src/gen/` files in different commits — review and commit them together so the server contract and client client stay in sync.
