import type { IdentityReconciliation } from '@atlasbi/contracts';
import type pg from 'pg';

/** How this adapter names itself in `identity.provider_subject`. */
export const PROVIDER = 'better-auth';

/**
 * The platform's own identity (`identity.*`, docs/09 §6.4), kept in step with better-auth by
 * explicit writes — no better-auth hook: the identity port is the only way accounts are created
 * (public sign-up is disabled). better-auth's user id is the principal id itself, so the identity
 * token's `sub` needs no translation.
 */
export function createPlatformIdentity(pool: pg.Pool) {
  async function inTransaction(run: (client: pg.PoolClient) => Promise<void>): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await run(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const insertPrincipal = async (client: pg.PoolClient, userId: string) => {
    await client.query(
      'INSERT INTO identity.principal (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
      [userId],
    );
    await client.query(
      `INSERT INTO identity.provider_subject (provider, subject, principal_id) VALUES ($1, $2, $3)
       ON CONFLICT (provider, subject) DO NOTHING`,
      [PROVIDER, userId, userId],
    );
  };
  const insertOrganization = (client: pg.PoolClient, organizationId: string) =>
    client.query('INSERT INTO identity.organization (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [
      organizationId,
    ]);

  const ids = async (sql: string, parameters: readonly string[] = []): Promise<string[]> =>
    (await pool.query<{ id: string }>(sql, [...parameters])).rows.map((row) => row.id);

  return {
    /** Idempotent: a person better-auth just created, as a principal of the platform. */
    recordPrincipal: (userId: string) => inTransaction((client) => insertPrincipal(client, userId)),

    /** Idempotent: an organization better-auth just created. */
    recordOrganization: (organizationId: string) =>
      inTransaction(async (client) => {
        await insertOrganization(client, organizationId);
      }),

    async reconcile(repair: boolean): Promise<IdentityReconciliation> {
      const missing = {
        principals: await ids(
          `
          SELECT u.id::text AS id FROM auth."user" u
          WHERE NOT EXISTS (
            SELECT 1 FROM identity.provider_subject s WHERE s.provider = $1 AND s.subject = u.id::text
          )
          ORDER BY 1`,
          [PROVIDER],
        ),
        organizations: await ids(`
          SELECT o.id::text AS id FROM auth.organization o
          WHERE NOT EXISTS (SELECT 1 FROM identity.organization i WHERE i.id = o.id)
          ORDER BY 1`),
      };
      // A principal no provider account backs: without any subject, or with a better-auth one
      // whose user is gone. Principals of other providers are not this adapter's to judge.
      const orphaned = {
        principals: await ids(
          `
          SELECT p.id::text AS id FROM identity.principal p
          WHERE NOT EXISTS (SELECT 1 FROM identity.provider_subject s WHERE s.principal_id = p.id)
             OR EXISTS (
               SELECT 1 FROM identity.provider_subject s
               WHERE s.principal_id = p.id AND s.provider = $1
                 AND NOT EXISTS (SELECT 1 FROM auth."user" u WHERE u.id::text = s.subject)
             )
          ORDER BY 1`,
          [PROVIDER],
        ),
        organizations: await ids(`
          SELECT i.id::text AS id FROM identity.organization i
          WHERE NOT EXISTS (SELECT 1 FROM auth.organization o WHERE o.id = i.id)
          ORDER BY 1`),
      };
      const anythingMissing = missing.principals.length + missing.organizations.length > 0;
      if (repair && anythingMissing) {
        await inTransaction(async (client) => {
          for (const userId of missing.principals) {
            await insertPrincipal(client, userId);
          }
          for (const organizationId of missing.organizations) {
            await insertOrganization(client, organizationId);
          }
        });
      }
      return { missing, orphaned, repaired: repair && anythingMissing };
    },
  };
}
