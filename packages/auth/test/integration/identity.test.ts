import type { IdentityPort } from '@atlasbi/contracts';
import type { ThrowawayDatabase } from '@atlasbi/database/testing';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createBetterAuthIdentity } from '../../src/index.ts';
import { createAuthDatabase, testSecret } from './support/auth-database.ts';

const PASSWORD = 'correct horse battery staple';

// What only this adapter promises. What any identity provider must do is the IdentityPort
// contract battery (identity-contract.test.ts).
describe('identity over better-auth (adapter specifics)', () => {
  let database: ThrowawayDatabase;
  let identity: IdentityPort;
  let anaId: string;
  let organizationId: string;
  const outbound: string[] = [];
  const realFetch = globalThis.fetch;

  const issue = async () =>
    identity.issueIdentityToken(
      (await identity.signIn({ email: 'ana@example.com', password: PASSWORD })).sessionToken,
    );

  beforeAll(async () => {
    // Every outbound request is recorded: identity must never call home (telemetry off, D7).
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      outbound.push(String(input instanceof Request ? input.url : input));
      return realFetch(input, init);
    });
    database = await createAuthDatabase();
    identity = createBetterAuthIdentity({
      connectionString: database.connectionString,
      secret: testSecret(),
    });
    ({ userId: anaId } = await identity.createUser({
      email: 'ana@example.com',
      name: 'Ana',
      password: PASSWORD,
    }));
    ({ organizationId } = await identity.createOrganization({
      name: 'Demo',
      slug: 'demo',
      ownerUserId: anaId,
    }));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await identity?.close();
    await database?.drop();
  });

  it('signs the identity token with EdDSA, for the platform API, for exactly 15 minutes (decision D4)', async () => {
    const token = await issue();
    const payload = decodeJwt(token);

    expect(decodeProtectedHeader(token).alg).toBe('EdDSA');
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'org', 'sub']);
    expect(payload).toMatchObject({
      sub: anaId,
      org: organizationId,
      iss: 'identity',
      aud: 'platform-api',
    });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(15 * 60);
  });

  it('keeps a token issued before sign-out valid until it expires — the documented cost of local verification', async () => {
    const { sessionToken } = await identity.signIn({
      email: 'ana@example.com',
      password: PASSWORD,
    });
    const token = await identity.issueIdentityToken(sessionToken);

    await identity.signOut(sessionToken);

    // docs/09 §7: bounded by the 15-minute lifetime; the session itself is gone (contract battery).
    await expect(identity.verifyIdentityToken(token)).resolves.toMatchObject({ userId: anaId });
  });

  it('never called any network service', () => {
    expect(outbound).toEqual([]);
  });
});
