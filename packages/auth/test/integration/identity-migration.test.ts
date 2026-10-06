import { migrateToLatest } from '@atlasbi/database';
import {
  createThrowawayDatabase,
  migrateTo,
  type ThrowawayDatabase,
} from '@atlasbi/database/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBetterAuthIdentity, DEMO_ACCESS } from '../../src/index.ts';
import { developmentAdminUrl, testSecret } from './support/auth-database.ts';

const BEFORE_IDENTITY = '000002_access_control';

// Migration 000003 is forward-only (docs/19 §5): it runs here over the state build step 4 left — the
// acceptance scenario `pnpm seed` writes — before it ever reaches a developer's database.
describe('migration 000003: the platform takes over identity from better-auth', () => {
  let database: ThrowawayDatabase;
  let pool: pg.Pool;
  let before: Record<string, string[]>;
  const rows = async (sql: string) =>
    (await pool.query<Record<string, unknown>>(sql)).rows.map((row) =>
      Object.values(row).map(String).join('|'),
    );
  const snapshot = async () => ({
    users: await rows('SELECT id FROM auth."user" ORDER BY 1'),
    organizations: await rows('SELECT id FROM auth.organization ORDER BY 1'),
    workspaces: await rows('SELECT id, organization_id, slug FROM access.workspace ORDER BY 1'),
    memberships: await rows(
      'SELECT workspace_id, user_id, role FROM access.workspace_membership ORDER BY 1, 2',
    ),
    entitlements: await rows(
      `SELECT workspace_id, user_id, dimension, all_values, array_to_string(allowed_values, ',')
       FROM access.data_entitlements ORDER BY 1, 2, 3`,
    ),
  });

  beforeAll(async () => {
    database = await createThrowawayDatabase(await developmentAdminUrl());
    await migrateTo({ connectionString: database.connectionString, target: BEFORE_IDENTITY });
    pool = new pg.Pool({ connectionString: database.connectionString, max: 2 });

    // The seed's scenario, written the way step 4 left it: provider tables and access tables only.
    const users = new Map<string, string>();
    for (const user of DEMO_ACCESS.users) {
      const { rows: created } = await pool.query<{ id: string }>(
        `INSERT INTO auth."user" (name, email, "emailVerified") VALUES ($1, $2, false) RETURNING id`,
        [user.name, user.email],
      );
      users.set(user.email, created[0]?.id ?? '');
    }
    const { rows: organization } = await pool.query<{ id: string }>(
      `INSERT INTO auth.organization (name, slug, "createdAt") VALUES ($1, $2, now()) RETURNING id`,
      [DEMO_ACCESS.organization.name, DEMO_ACCESS.organization.slug],
    );
    const organizationId = organization[0]?.id ?? '';
    const workspaces = new Map<string, string>();
    for (const workspace of DEMO_ACCESS.workspaces) {
      const { rows: created } = await pool.query<{ id: string }>(
        'INSERT INTO access.workspace (organization_id, slug, name) VALUES ($1, $2, $3) RETURNING id',
        [organizationId, workspace.slug, workspace.name],
      );
      workspaces.set(workspace.slug, created[0]?.id ?? '');
    }
    for (const userId of users.values()) {
      await pool.query(
        `INSERT INTO auth.member ("organizationId", "userId", role, "createdAt") VALUES ($1, $2, 'member', now())`,
        [organizationId, userId],
      );
    }
    for (const grant of DEMO_ACCESS.grants) {
      const workspaceId = workspaces.get(grant.workspace);
      const userId = users.get(grant.user);
      await pool.query(
        'INSERT INTO access.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, $3)',
        [workspaceId, userId, grant.role],
      );
      await pool.query(
        `INSERT INTO access.data_entitlements (workspace_id, user_id, dimension, all_values, allowed_values)
         VALUES ($1, $2, 'region', $3, $4)`,
        [
          workspaceId,
          userId,
          grant.region.kind === 'all',
          grant.region.kind === 'listed' ? [...grant.region.values] : [],
        ],
      );
    }
    before = await snapshot();

    await migrateToLatest({ connectionString: database.connectionString });
  });

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it('keeps every row of the seed scenario', async () => {
    expect(before.users).toHaveLength(DEMO_ACCESS.users.length);
    expect(before.memberships).toHaveLength(DEMO_ACCESS.grants.length);
    expect(await snapshot()).toEqual(before);
  });

  it('records every person and organization in the platform identity, better-auth as their provider', async () => {
    expect(await rows('SELECT id FROM identity.principal ORDER BY 1')).toEqual(before.users);
    expect(await rows('SELECT id FROM identity.organization ORDER BY 1')).toEqual(
      before.organizations,
    );
    expect(
      await rows(
        'SELECT provider, subject, principal_id FROM identity.provider_subject ORDER BY 2',
      ),
    ).toEqual((before.users ?? []).map((id) => `better-auth|${id}|${id}`));
  });

  it('leaves no access row without its identity', async () => {
    expect(
      await rows(`
        SELECT w.id FROM access.workspace w
        WHERE NOT EXISTS (SELECT 1 FROM identity.organization o WHERE o.id = w.organization_id)`),
    ).toEqual([]);
    expect(
      await rows(`
        SELECT m.user_id FROM access.workspace_membership m
        WHERE NOT EXISTS (SELECT 1 FROM identity.principal p WHERE p.id = m.user_id)`),
    ).toEqual([]);
  });

  it("points authorization's foreign keys at identity.*, never at auth.*", async () => {
    const foreignKeys = await rows(`
      SELECT c.conrelid::regclass::text, c.confrelid::regclass::text
      FROM pg_constraint c
      WHERE c.contype = 'f' AND c.connamespace = 'access'::regnamespace
      ORDER BY 1, 2`);

    expect(foreignKeys).toEqual([
      'access.data_entitlements|access.workspace_membership',
      'access.workspace|identity.organization',
      'access.workspace_membership|access.workspace',
      'access.workspace_membership|identity.principal',
    ]);
    expect(foreignKeys.join()).not.toContain('auth.');
  });

  it('leaves the provider and the platform in step, as reconciliation sees them', async () => {
    const identity = createBetterAuthIdentity({
      connectionString: database.connectionString,
      secret: testSecret(),
    });
    try {
      await expect(identity.reconcile()).resolves.toEqual({
        missing: { principals: [], organizations: [] },
        orphaned: { principals: [], organizations: [] },
        repaired: false,
      });
    } finally {
      await identity.close();
    }
  });
});
