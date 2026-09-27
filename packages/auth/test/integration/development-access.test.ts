import type { IdentityPort } from '@atlasbi/contracts';
import type { ThrowawayDatabase } from '@atlasbi/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AccessDirectory,
  createAccessDirectory,
  createBetterAuthIdentity,
  DemoPasswordMismatchError,
  seedDemoAccess,
} from '../../src/index.ts';
import { createAuthDatabase, testSecret } from './support/auth-database.ts';

const PASSWORD = 'a-demo-password-for-tests';

describe('the demo access of `pnpm seed` (docs/16 §4, docs/19 §6)', () => {
  let database: ThrowawayDatabase;
  let identity: IdentityPort;
  let access: AccessDirectory;

  beforeAll(async () => {
    database = await createAuthDatabase();
    identity = createBetterAuthIdentity({
      connectionString: database.connectionString,
      secret: testSecret(),
    });
    access = createAccessDirectory({ connectionString: database.connectionString });
  });

  afterAll(async () => {
    await access?.close();
    await identity?.close();
    await database?.drop();
  });

  it('leaves the acceptance scenario, proven through sign in, identity token and security context', async () => {
    const seeded = await seedDemoAccess(identity, access, PASSWORD);

    expect(seeded).toEqual({
      organizationSlug: 'demo',
      rows: [
        {
          email: 'ana@example.com',
          workspace: 'comercial',
          role: 'admin',
          region: { kind: 'all' },
        },
        {
          email: 'ana@example.com',
          workspace: 'finanzas',
          role: 'viewer',
          region: { kind: 'listed', values: ['North'] },
        },
        {
          email: 'bruno@example.com',
          workspace: 'finanzas',
          role: 'viewer',
          region: { kind: 'listed', values: ['South'] },
        },
      ],
    });
  });

  it('is idempotent: a second run changes nothing', async () => {
    const first = await seedDemoAccess(identity, access, PASSWORD);
    const second = await seedDemoAccess(identity, access, PASSWORD);

    expect(second).toEqual(first);
  });

  it('says so when the demo users already exist with another password', async () => {
    const error = await seedDemoAccess(identity, access, 'another-demo-password').catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(DemoPasswordMismatchError);
    expect((error as DemoPasswordMismatchError).remedy).toContain('ATLASBI_SEED_DEMO_PASSWORD');
    expect((error as Error).message).not.toContain(PASSWORD);
  });
});
