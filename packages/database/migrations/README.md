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

The first tables arrive with build step 4 (Auth):

- `000001_auth_schema.sql` — better-auth's identity tables in the `auth` schema. **Generated**
  from the platform's better-auth options, never written by hand; a schema contract test in
  `packages/auth` says when an upgrade needs a new migration.
- `000002_access_control.sql` — the platform's own authorization in the `access` schema:
  `workspace`, `workspace_membership` and `data_entitlements` (`docs/09` §6.1–§6.2).
- `000003_identity.sql` — the platform's own identity in the `identity` schema: `organization`,
  `principal` and `provider_subject`, filled once from better-auth's tables; `access` now
  references them, never `auth.*` (`docs/09` §6.4). The last migration that reads the provider's
  tables. Tested over the `pnpm seed` scenario before release (`identity-migration.test.ts`).
