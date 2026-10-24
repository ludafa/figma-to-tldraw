---
name: add-shadcn-component
description: Install a shadcn/ui primitive into apps/client/src/components/ui/. Use when the user asks for a shadcn component ("add a Sheet", "install the dropdown-menu", "I need a sonner toast").
---

# Add a shadcn component

shadcn/ui generates source files into the project — there's no runtime import from a package. The CLI uses `apps/client/components.json` (already configured: aliases for `@/components`, `@/components/ui`, `@/lib/utils`, `@/hooks`).

## Steps

1. **Confirm the component name** with the shadcn registry. Common names: `button`, `dialog`, `sheet`, `dropdown-menu`, `tabs`, `toast`/`sonner`, `tooltip`, `popover`, `command`.

2. **Run from the client workspace:**

   ```bash
   pnpm --filter @figma-to-tldraw/client dlx shadcn@latest add <component-name>
   ```

   This writes `.tsx` files into `apps/client/src/components/ui/` and may add deps to `apps/client/package.json`.

3. **Re-run install if deps were added:** `pnpm install`.

4. **Format the new files:** `pnpm format`. shadcn's output doesn't follow the project's formatting (notably the Tailwind class order, which oxfmt derives from `main.css`), and `pnpm lint` fails until it's run.

5. **Use it.** Import from `@/components/ui/<component-name>`.

## Notes

- `components.json` style is `base-vega`, neutral base color, lucide icons, CSS variables on. Don't switch styles per-component.
- Generated files are checked in — they are project source code, not dependencies. Edit them freely.
- If shadcn asks about overwriting existing files, say no unless the user explicitly wants the upgrade.
- Don't try to install shadcn components with `pnpm add` — that's not how shadcn works.
