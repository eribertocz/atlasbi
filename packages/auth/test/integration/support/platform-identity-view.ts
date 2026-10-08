import type { PlatformIdentityView } from '@atlasbi/contracts-testing';
import pg from 'pg';

/**
 * The platform's identity tables of one test database, for the IdentityPort battery. Plain SQL on
 * `identity.*`: the platform's own tables, the same whatever provider an adapter wraps.
 */
export function platformIdentityView(connectionString: string): PlatformIdentityView & {
  close(): Promise<void>;
} {
  const pool = new pg.Pool({ connectionString, max: 2 });
  const ids = async (sql: string) =>
    (await pool.query<{ id: string }>(sql)).rows.map((row) => row.id);
  return {
    principals: () => ids('SELECT id::text AS id FROM identity.principal ORDER BY 1'),
    organizations: () => ids('SELECT id::text AS id FROM identity.organization ORDER BY 1'),
    async forgetPrincipal(id) {
      await pool.query('DELETE FROM identity.principal WHERE id = $1', [id]);
    },
    async forgetOrganization(id) {
      await pool.query('DELETE FROM identity.organization WHERE id = $1', [id]);
    },
    async addStrayPrincipal() {
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO identity.principal (id) VALUES (gen_random_uuid()) RETURNING id::text AS id',
      );
      return rows[0]?.id ?? '';
    },
    close: () => pool.end(),
  };
}
