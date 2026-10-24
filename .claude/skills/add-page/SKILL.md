---
name: add-page
description: Add a TanStack Router file-based page to the client app, wiring it under the right layout (authenticated vs public). Use when the user asks to "add a page", "create a route at /foo", or "add a screen for X".
---

# Add a page

Routes are file-based and live under `apps/client/src/routes/`. The TanStack Router Vite plugin rewrites `routeTree.gen.ts` automatically when files appear under `routes/` — never hand-edit the generated tree.

Two layouts decide auth behavior:

- `_app.tsx` — authenticated. Pages here redirect to `/login` if no session.
- `_auth.tsx` — public-with-no-session. Pages here redirect to `/` if a session exists (so logged-in users don't see login forms).

## Steps

1. **Decide the layout.** Authenticated app pages → put route under `apps/client/src/routes/_app/`. Auth flows (login, password reset, etc.) → under `apps/client/src/routes/_auth/`. Pages that need neither layout (e.g. a public landing page) → directly under `apps/client/src/routes/`.

2. **Create the page component** in `apps/client/src/pages/<name>.tsx` and export it as a named export, e.g. `export function ProjectListPage() { … }`. Keep page components in `pages/`, not in `routes/` — `routes/` is purely for routing wiring.

3. **Create the route file** in the chosen routes directory:

   For a static path, e.g. `/projects`:

   ```tsx
   // apps/client/src/routes/_app/projects.tsx
   import { createFileRoute } from '@tanstack/react-router';

   import { ProjectListPage } from '../../pages/project-list';

   export const Route = createFileRoute('/_app/projects')({
     component: ProjectListPage,
   });
   ```

   For dynamic params, e.g. `/projects/:projectId`:

   ```tsx
   // apps/client/src/routes/_app/projects.$projectId.tsx
   import { createFileRoute } from '@tanstack/react-router';

   import { ProjectDetailPage } from '../../pages/project-detail';

   export const Route = createFileRoute('/_app/projects/$projectId')({
     component: ProjectDetailPage,
   });
   ```

   File-name convention recap: `.` becomes `/`, `$x` becomes `:x`, `index` is the bare directory path.

4. **(Optional) Add a `loader`** for data the page needs before render. The handler returns data; access it in the page via `Route.useLoaderData()`. Prefer Kubb-generated client functions (e.g. `getApiNotes`) over hand-written `fetch`.

5. **Run `pnpm dev:client`** so the plugin regenerates `routeTree.gen.ts`. The dev server then live-reloads.

6. **Typecheck:** `pnpm --filter @figma-to-tldraw/client exec tsc -b`. The generated tree gives you typed `Link to="/projects/$projectId" params={{ projectId }}`.

## Don'ts

- Don't re-check sessions in the page itself; the layout's `beforeLoad` already does it.
- Don't import from `routeTree.gen.ts` manually — use the typed `<Link>` and `useNavigate` APIs.
- Don't drop a page directly under `routes/` if it should be auth-gated. Filing it under `_app/` is what enforces the guard.
