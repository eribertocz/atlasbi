import { AuthenticationError, type IdentityPort } from '@atlasbi/contracts';
import type { ThrowawayDatabase } from '@atlasbi/database/testing';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createBetterAuthIdentity } from '../../src/index.ts';
import { createAuthDatabase, testSecret } from './support/auth-database.ts';

const PASSWORD = 'correct horse battery staple';

async function failure(action: Promise<unknown>): Promise<AuthenticationError> {
  const error = await action.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AuthenticationError)) {
    throw new Error(`expected an AuthenticationError, got ${String(error)}`);
  }
  return error;
}

describe('identity over better-auth (IdentityPort)', () => {
  let database: ThrowawayDatabase;
  let identity: IdentityPort;
  let anaId: string;
  let organizationId: string;
  const outbound: string[] = [];
  const realFetch = globalThis.fetch;

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
      email: ' Ana@Example.COM ',
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

  describe('users (an administrative action — there is no public sign-up)', () => {
    it('normalizes the email, and refuses a duplicate', async () => {
      await expect(identity.findUserByEmail('ana@example.com')).resolves.toEqual({
        userId: anaId,
      });
      expect(
        (
          await failure(
            identity.createUser({ email: 'ANA@example.com', name: 'Ana', password: PASSWORD }),
          )
        ).code,
      ).toBe('invalid_request');
    });

    it('refuses a bad email, an empty name, and a password shorter than 12 characters', async () => {
      for (const user of [
        { email: 'not-an-email', name: 'X', password: PASSWORD },
        { email: 'x@example.com', name: '   ', password: PASSWORD },
        { email: 'x@example.com', name: 'X', password: 'short-pw-11' },
      ]) {
        expect((await failure(identity.createUser(user))).code).toBe('invalid_request');
      }
      await expect(identity.findUserByEmail('x@example.com')).resolves.toBeUndefined();
    });
  });

  describe('sign in', () => {
    it('fails the same way for a wrong password and an unknown email, never echoing either', async () => {
      const wrongPassword = await failure(
        identity.signIn({ email: 'ana@example.com', password: 'not the password 123' }),
      );
      const unknownEmail = await failure(
        identity.signIn({ email: 'nobody@example.com', password: PASSWORD }),
      );

      expect(wrongPassword.code).toBe('invalid_credentials');
      expect(unknownEmail.code).toBe('invalid_credentials');
      expect(wrongPassword.message).toBe(unknownEmail.message);
      expect(wrongPassword.message).not.toMatch(/not the password|nobody|ana@/);
    });

    it('opens a session with the right password, whatever the case of the email', async () => {
      const { sessionToken } = await identity.signIn({
        email: 'ANA@example.com',
        password: PASSWORD,
      });

      expect(sessionToken.length).toBeGreaterThan(20);
      expect(sessionToken).not.toContain(PASSWORD);
    });
  });

  describe('the identity token (decision D4)', () => {
    it('carries the user and the organization only — never a role or an entitlement', async () => {
      const { sessionToken } = await identity.signIn({
        email: 'ana@example.com',
        password: PASSWORD,
      });
      const token = await identity.issueIdentityToken(sessionToken);
      const payload = decodeJwt(token);

      expect(decodeProtectedHeader(token).alg).toBe('EdDSA');
      expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'org', 'sub']);
      expect(payload).toMatchObject({ sub: anaId, org: organizationId, iss: 'identity' });
      expect(payload.aud).toBe('platform-api');
      expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(15 * 60);
      await expect(identity.verifyIdentityToken(token)).resolves.toEqual({
        userId: anaId,
        organizationId,
      });
    });

    it('rejects a tampered, an unsigned, and a truncated token', async () => {
      const { sessionToken } = await identity.signIn({
        email: 'ana@example.com',
        password: PASSWORD,
      });
      const token = await identity.issueIdentityToken(sessionToken);
      const [head, body, signature] = token.split('.');
      const forgedBody = Buffer.from(
        JSON.stringify({ ...decodeJwt(token), org: crypto.randomUUID() }),
      ).toString('base64url');
      const unsignedHead = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
        'base64url',
      );

      for (const bad of [
        `${head ?? ''}.${forgedBody}.${signature ?? ''}`,
        `${unsignedHead}.${body ?? ''}.`,
        `${head ?? ''}.${body ?? ''}`,
      ]) {
        expect((await failure(identity.verifyIdentityToken(bad))).code).toBe('invalid_token');
      }
    });

    it('rejects a token from another deployment (another database, other keys)', async () => {
      const other = await createAuthDatabase();
      const otherIdentity = createBetterAuthIdentity({
        connectionString: other.connectionString,
        secret: testSecret(),
      });
      try {
        const { userId } = await otherIdentity.createUser({
          email: 'eve@example.com',
          name: 'Eve',
          password: PASSWORD,
        });
        await otherIdentity.createOrganization({
          name: 'Other',
          slug: 'other',
          ownerUserId: userId,
        });
        const { sessionToken } = await otherIdentity.signIn({
          email: 'eve@example.com',
          password: PASSWORD,
        });
        const foreign = await otherIdentity.issueIdentityToken(sessionToken);

        expect((await failure(identity.verifyIdentityToken(foreign))).code).toBe('invalid_token');
      } finally {
        await otherIdentity.close();
        await other.drop();
      }
    });

    it('names no organization for someone who belongs to none: no token is issued', async () => {
      await identity.createUser({ email: 'loner@example.com', name: 'Loner', password: PASSWORD });
      const { sessionToken } = await identity.signIn({
        email: 'loner@example.com',
        password: PASSWORD,
      });

      expect((await failure(identity.issueIdentityToken(sessionToken))).code).toBe(
        'invalid_request',
      );
    });
  });

  describe('sign out', () => {
    it('ends the session; a token issued before stays valid until it expires (local verification)', async () => {
      const { sessionToken } = await identity.signIn({
        email: 'ana@example.com',
        password: PASSWORD,
      });
      const token = await identity.issueIdentityToken(sessionToken);

      await identity.signOut(sessionToken);

      expect((await failure(identity.issueIdentityToken(sessionToken))).code).toBe(
        'session_not_found',
      );
      expect((await failure(identity.signOut(sessionToken))).code).toBe('session_not_found');
      // The documented cost of verifying locally (docs/09 §7): bounded by the 15-minute lifetime.
      await expect(identity.verifyIdentityToken(token)).resolves.toMatchObject({ userId: anaId });
    });
  });

  it('never called any network service', () => {
    expect(outbound).toEqual([]);
  });
});
