import { AccessDeniedError, type Identity, type IdentityPort } from '@atlasbi/contracts';
import type { ThrowawayDatabase } from '@atlasbi/database/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AccessDirectory,
  createAccessDirectory,
  createBetterAuthIdentity,
} from '../../src/index.ts';
import { createAuthDatabase, testSecret } from './support/auth-database.ts';

const PASSWORD = 'correct horse battery staple';

async function denial(action: Promise<unknown>): Promise<string> {
  const error = await action.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  return error instanceof AccessDeniedError ? error.reason : `not denied: ${String(error)}`;
}

// The scenario of the MVP acceptance script (docs/16 §4) and of docs/09 §6.1–§6.2: the same
// person with a different role per workspace, and two viewers who see different data.
describe('authorization owned by the platform (workspace_membership + data_entitlements)', () => {
  let database: ThrowawayDatabase;
  let identity: IdentityPort;
  let access: AccessDirectory;
  let ana: Identity;
  let bruno: Identity;
  let comercial: string;
  let finanzas: string;
  let foreignWorkspace: string;

  beforeAll(async () => {
    database = await createAuthDatabase();
    identity = createBetterAuthIdentity({
      connectionString: database.connectionString,
      secret: testSecret(),
    });
    access = createAccessDirectory({ connectionString: database.connectionString });

    const { userId: anaId } = await identity.createUser({
      email: 'ana@example.com',
      name: 'Ana',
      password: PASSWORD,
    });
    const { userId: brunoId } = await identity.createUser({
      email: 'bruno@example.com',
      name: 'Bruno',
      password: PASSWORD,
    });
    const { organizationId } = await identity.createOrganization({
      name: 'Demo',
      slug: 'demo',
      ownerUserId: anaId,
    });
    await identity.addOrganizationMember({ organizationId, userId: brunoId });
    // Idempotent: adding a member twice changes nothing.
    await identity.addOrganizationMember({ organizationId, userId: brunoId });
    ana = { userId: anaId, organizationId };
    bruno = { userId: brunoId, organizationId };

    ({ workspaceId: comercial } = await access.createWorkspace({
      organizationId,
      slug: 'comercial',
      name: 'Comercial',
    }));
    ({ workspaceId: finanzas } = await access.createWorkspace({
      organizationId,
      slug: 'finanzas',
      name: 'Finanzas',
    }));
    await access.setMembership({ workspaceId: comercial, userId: anaId, role: 'admin' });
    await access.setMembership({ workspaceId: finanzas, userId: anaId, role: 'viewer' });
    await access.setMembership({ workspaceId: finanzas, userId: brunoId, role: 'viewer' });
    await access.grantEntitlement({
      workspaceId: comercial,
      userId: anaId,
      dimension: 'region',
      entitlement: { kind: 'all' },
    });
    await access.grantEntitlement({
      workspaceId: finanzas,
      userId: anaId,
      dimension: 'region',
      entitlement: { kind: 'listed', values: ['North'] },
    });
    await access.grantEntitlement({
      workspaceId: finanzas,
      userId: brunoId,
      dimension: 'region',
      entitlement: { kind: 'listed', values: ['South'] },
    });

    // Another organization, with a workspace of its own.
    const { userId: eveId } = await identity.createUser({
      email: 'eve@example.com',
      name: 'Eve',
      password: PASSWORD,
    });
    const other = await identity.createOrganization({
      name: 'Other',
      slug: 'other',
      ownerUserId: eveId,
    });
    ({ workspaceId: foreignWorkspace } = await access.createWorkspace({
      organizationId: other.organizationId,
      slug: 'comercial',
      name: 'Comercial',
    }));
    // Even a membership row there does not open it to someone from another organization.
    await access.setMembership({ workspaceId: foreignWorkspace, userId: anaId, role: 'admin' });
  });

  afterAll(async () => {
    await access?.close();
    await identity?.close();
    await database?.drop();
  });

  it('gives the same person a different role in each workspace', async () => {
    const inComercial = await access.resolveSecurityContext(ana, comercial);
    const inFinanzas = await access.resolveSecurityContext(ana, finanzas);

    expect(inComercial).toEqual({
      userId: ana.userId,
      organizationId: ana.organizationId,
      workspaceId: comercial,
      workspaceRole: 'admin',
      entitlements: { region: { kind: 'all' } },
    });
    expect(inFinanzas.workspaceRole).toBe('viewer');
    expect(inFinanzas.entitlements).toEqual({ region: { kind: 'listed', values: ['North'] } });
  });

  it('lets two people with the same role see different data', async () => {
    const anaView = await access.resolveSecurityContext(ana, finanzas);
    const brunoView = await access.resolveSecurityContext(bruno, finanzas);

    expect(anaView.workspaceRole).toBe(brunoView.workspaceRole);
    expect(brunoView.entitlements).toEqual({ region: { kind: 'listed', values: ['South'] } });
  });

  it('denies a workspace of another organization, even with a membership row there', async () => {
    await expect(denial(access.resolveSecurityContext(ana, foreignWorkspace))).resolves.toBe(
      'other_organization',
    );
  });

  it('denies someone without a membership, and a workspace that does not exist', async () => {
    await expect(denial(access.resolveSecurityContext(bruno, comercial))).resolves.toBe(
      'not_a_member',
    );
    await expect(denial(access.resolveSecurityContext(ana, crypto.randomUUID()))).resolves.toBe(
      'workspace_not_found',
    );
    await expect(denial(access.resolveSecurityContext(ana, 'comercial'))).resolves.toBe(
      'workspace_not_found',
    );
  });

  it('denies by default: a member without a grant on a dimension sees nothing of it', async () => {
    await access.revokeEntitlement({
      workspaceId: finanzas,
      userId: bruno.userId,
      dimension: 'region',
    });
    try {
      const context = await access.resolveSecurityContext(bruno, finanzas);

      expect(context.workspaceRole).toBe('viewer');
      expect(context.entitlements).toEqual({});
    } finally {
      await access.grantEntitlement({
        workspaceId: finanzas,
        userId: bruno.userId,
        dimension: 'region',
        entitlement: { kind: 'listed', values: ['South'] },
      });
    }
  });

  it('replaces a grant instead of piling grants up', async () => {
    await access.grantEntitlement({
      workspaceId: finanzas,
      userId: ana.userId,
      dimension: 'region',
      entitlement: { kind: 'listed', values: ['North', 'East', 'North'] },
    });
    try {
      await expect(access.resolveSecurityContext(ana, finanzas)).resolves.toMatchObject({
        entitlements: { region: { kind: 'listed', values: ['North', 'East'] } },
      });
    } finally {
      await access.grantEntitlement({
        workspaceId: finanzas,
        userId: ana.userId,
        dimension: 'region',
        entitlement: { kind: 'listed', values: ['North'] },
      });
    }
  });

  describe('the database constraints (migration 000002), without the directory in between', () => {
    let client: pg.Client;

    beforeAll(async () => {
      client = new pg.Client({ connectionString: database.connectionString });
      await client.connect();
    });

    afterAll(async () => {
      await client?.end();
    });

    async function rejected(statement: string, values: unknown[]): Promise<string | undefined> {
      await client.query('savepoint probe');
      try {
        await client.query(statement, values);
        return undefined;
      } catch (error) {
        return (error as { code?: string }).code;
      } finally {
        await client.query('rollback to savepoint probe');
      }
    }

    it('refuses an empty list, "all" with values, an unknown role and a grant without membership', async () => {
      await client.query('begin');
      try {
        const insert =
          'insert into access.data_entitlements (workspace_id, user_id, dimension, all_values, allowed_values) values ($1, $2, $3, $4, $5)';
        // 23514: check violation; 23503: foreign key violation.
        await expect(
          rejected(insert, [comercial, ana.userId, 'category', false, []]),
        ).resolves.toBe('23514');
        await expect(
          rejected(insert, [comercial, ana.userId, 'category', true, ['Hardware']]),
        ).resolves.toBe('23514');
        await expect(rejected(insert, [comercial, bruno.userId, 'region', true, []])).resolves.toBe(
          '23503',
        );
        await expect(
          rejected(
            'insert into access.workspace_membership (workspace_id, user_id, role) values ($1, $2, $3)',
            [comercial, bruno.userId, 'owner'],
          ),
        ).resolves.toBe('23514');
      } finally {
        await client.query('rollback');
      }
    });

    it('removes what someone could see together with their membership', async () => {
      await client.query('begin');
      try {
        await client.query(
          'delete from access.workspace_membership where workspace_id = $1 and user_id = $2',
          [finanzas, bruno.userId],
        );
        const left = await client.query(
          'select count(*)::int as n from access.data_entitlements where workspace_id = $1 and user_id = $2',
          [finanzas, bruno.userId],
        );

        expect(left.rows[0]).toEqual({ n: 0 });
      } finally {
        await client.query('rollback');
      }
    });
  });
});
