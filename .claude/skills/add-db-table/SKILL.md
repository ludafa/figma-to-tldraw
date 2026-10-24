---
name: add-db-table
description: Add a new Drizzle (SQLite) table and apply the migration. Use when the user asks to "add a table", "add a model", or to persist a new entity. Do NOT touch the better-auth tables (user, session, account, verification).
---

# Add a DB table

Tables are defined in `apps/server/src/db/schema.ts` using `sqliteTable` from `drizzle-orm/sqlite-core`. After editing the schema, generate and apply a migration. Drizzle Kit produces a numbered SQL file under `apps/server/drizzle/` — both the SQL and the journal must be committed.

## Steps

1. **Edit `apps/server/src/db/schema.ts`.** Add the new `sqliteTable(...)` export below the better-auth tables. Follow the existing patterns:
   - Primary key: `text('id').primaryKey()` (use `crypto.randomUUID()` at insert time)
   - Foreign keys to user: `text('user_id').notNull().references(() => user.id)`
   - Timestamps: `integer('created_at', { mode: 'timestamp' }).notNull()`
   - Booleans: `integer('flag', { mode: 'boolean' }).notNull()`
   - Don't change the four better-auth tables (`user`, `session`, `account`, `verification`).

2. **Generate the migration:**
   `pnpm --filter @figma-to-tldraw/server run db:generate`
   Drizzle Kit writes a new SQL file under `apps/server/drizzle/` and updates `meta/_journal.json`. Read the generated SQL to confirm only your intended changes are present — if it tries to drop a better-auth column, abort and investigate.

3. **Apply it:**
   `pnpm --filter @figma-to-tldraw/server run db:migrate`
   This mutates `apps/server/data.db` (or whatever `DATABASE_PATH` points to).

4. **(Optional) Inspect with Drizzle Studio:**
   `pnpm --filter @figma-to-tldraw/server run db:studio`

5. **Use the table in a route.** Import from `apps/server/src/db/schema.ts` and query via `db` from `apps/server/src/db/instance.ts`. Drizzle queries are type-safe — no codegen needed.

## Don'ts

- Don't write SQL migrations by hand — let drizzle-kit generate from the schema.
- Don't `rm` and re-create migrations after they've shipped to anyone. If the schema needs to change, write a new migration.
- Don't add a column without a default to an existing table that already has rows — drizzle will refuse, and adding `.default(...)` or making the column nullable is the right fix.
