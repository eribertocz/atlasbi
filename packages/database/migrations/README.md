# Platform database migrations

The only mechanism that creates or changes tables in the platform database
(`docs/19-operabilidad-runtime.md` §5). Applied automatically by `pnpm bootstrap`, `pnpm dev`
and `pnpm stack:up` — never by hand.

- **One plain SQL file per migration**, named `000001_short_description.sql` (six digits,
  lowercase `snake_case`, English — `docs/21-engineering-standards.md` §4 and §8).
- **Forward-only.** There is no `down`: a mistake in an applied migration is fixed by a new
  migration, never by editing the old one.
- **Atomic batch.** On Postgres, all pending migrations run in a single transaction; if one
  fails, none of them is applied.
- The latest applied file is the "DB Migration" contract version (`docs/21` §2).

This folder is empty on purpose until build step 4 (Auth), which creates the first tables
(`workspace_membership`, `data_entitlements`).
