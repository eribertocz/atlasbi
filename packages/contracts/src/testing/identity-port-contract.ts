import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AUTHENTICATION_ERROR_CODES,
  AuthenticationError,
  type AuthenticationErrorCode,
  type IdentityPort,
} from '../auth/identity-port.ts';

/** One deployment of the identity provider: its own users, organizations, sessions and keys. */
export interface IdentityDeployment {
  identity: IdentityPort;
  dispose(): Promise<void>;
}

export interface IdentityPortFixture {
  /** A new, empty deployment; two calls give two independent ones (other keys, other users). */
  create(): Promise<IdentityDeployment>;
}

const PASSWORD = 'correct horse battery staple';
/** Registered JWT claims a provider may add; anything else beside `sub` and `org` is a leak. */
const REGISTERED_CLAIMS = new Set(['iss', 'aud', 'iat', 'exp', 'nbf', 'jti']);
/** "Short-lived" (docs/09 §7): the documented cost of local verification stays bounded. */
const MAX_IDENTITY_TOKEN_LIFETIME_SECONDS = 15 * 60;

/** The AuthenticationError a call rejects with — failing the test if it resolves or throws else. */
export async function expectAuthenticationError(
  call: Promise<unknown>,
  code: AuthenticationErrorCode,
): Promise<AuthenticationError> {
  const error = await call.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error, `expected AuthenticationError(${code})`).toBeInstanceOf(AuthenticationError);
  const authentication = error as AuthenticationError;
  expect(AUTHENTICATION_ERROR_CODES).toContain(authentication.code);
  expect(authentication.code).toBe(code);
  return authentication;
}

/** The header and claims of a compact JWS, read without verifying it — only to inspect them. */
export function decodeToken(token: string): {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
} {
  const [header, payload] = token.split('.');
  const decode = (part: string | undefined) =>
    JSON.parse(Buffer.from(part ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
  return { header: decode(header), claims: decode(payload) };
}

/**
 * The battery every IdentityPort adapter must pass (docs/21 §3.3): who someone is, and nothing
 * else (docs/09 §6.1, §7). Independent of the provider: no algorithm, issuer or cookie name is
 * checked here — those are the adapter's own tests.
 */
export function describeIdentityPortContract(
  adapterName: string,
  fixture: IdentityPortFixture,
): void {
  describe(`IdentityPort contract: ${adapterName}`, () => {
    let deployment: IdentityDeployment;
    let identity: IdentityPort;
    let anaId: string;
    let organizationId: string;

    const signedIn = (email: string) => identity.signIn({ email, password: PASSWORD });

    beforeAll(async () => {
      deployment = await fixture.create();
      identity = deployment.identity;
      ({ userId: anaId } = await identity.createUser({
        email: ' Ana@Example.COM ',
        name: 'Ana',
        password: PASSWORD,
      }));
      ({ organizationId } = await identity.createOrganization({
        name: 'Contract',
        slug: 'contract',
        ownerUserId: anaId,
      }));
    });

    afterAll(async () => {
      await deployment?.dispose();
    });

    describe('users — created by an administrative action, never by public sign-up', () => {
      it('normalizes the email, and refuses the same email twice', async () => {
        await expect(identity.findUserByEmail('ana@example.com')).resolves.toEqual({
          userId: anaId,
        });
        await expectAuthenticationError(
          identity.createUser({ email: 'ANA@example.com', name: 'Ana', password: PASSWORD }),
          'invalid_request',
        );
      });

      it('refuses a bad email, an empty name and a password shorter than 12 characters', async () => {
        for (const user of [
          { email: 'not-an-email', name: 'X', password: PASSWORD },
          { email: 'x@example.com', name: '   ', password: PASSWORD },
          { email: 'x@example.com', name: 'X', password: 'short-pw-11' },
        ]) {
          await expectAuthenticationError(identity.createUser(user), 'invalid_request');
        }
        await expect(identity.findUserByEmail('x@example.com')).resolves.toBeUndefined();
      });
    });

    describe('organizations', () => {
      it('finds an organization by its slug, and adds a member only once', async () => {
        const { userId } = await identity.createUser({
          email: 'member@example.com',
          name: 'Member',
          password: PASSWORD,
        });

        await expect(identity.findOrganizationBySlug('contract')).resolves.toEqual({
          organizationId,
        });
        await expect(identity.findOrganizationBySlug('nowhere')).resolves.toBeUndefined();
        await identity.addOrganizationMember({ organizationId, userId });
        await identity.addOrganizationMember({ organizationId, userId });

        const { sessionToken } = await signedIn('member@example.com');
        await expect(
          identity.verifyIdentityToken(await identity.issueIdentityToken(sessionToken)),
        ).resolves.toEqual({ userId, organizationId });
      });
    });

    describe('sign in', () => {
      it('fails the same way for a wrong password and an unknown email, never echoing either', async () => {
        const wrongPassword = await expectAuthenticationError(
          identity.signIn({ email: 'ana@example.com', password: 'not the password 123' }),
          'invalid_credentials',
        );
        const unknownEmail = await expectAuthenticationError(
          identity.signIn({ email: 'nobody@example.com', password: PASSWORD }),
          'invalid_credentials',
        );

        expect(wrongPassword.message).toBe(unknownEmail.message);
        expect(wrongPassword.message).not.toMatch(/not the password|nobody|ana@/);
      });

      it('opens a session with the right password, whatever the case of the email', async () => {
        const { sessionToken } = await signedIn('ANA@example.com ');

        expect(sessionToken.length).toBeGreaterThan(20);
        expect(sessionToken).not.toContain(PASSWORD);
      });
    });

    describe('the identity token', () => {
      it('names the person and the organization, nothing else, and lives 15 minutes at most', async () => {
        const token = await identity.issueIdentityToken(
          (await signedIn('ana@example.com')).sessionToken,
        );
        const { header, claims } = decodeToken(token);

        expect(header.alg).not.toBe('none');
        expect(claims).toMatchObject({ sub: anaId, org: organizationId });
        expect(
          Object.keys(claims)
            .filter((name) => !REGISTERED_CLAIMS.has(name))
            .sort(),
        ).toEqual(['org', 'sub']);
        const lifetime = Number(claims.exp) - Number(claims.iat ?? Math.floor(Date.now() / 1000));
        expect(lifetime).toBeGreaterThan(0);
        expect(lifetime).toBeLessThanOrEqual(MAX_IDENTITY_TOKEN_LIFETIME_SECONDS);
        await expect(identity.verifyIdentityToken(token)).resolves.toEqual({
          userId: anaId,
          organizationId,
        });
      });

      it('rejects a tampered, an unsigned and a truncated token', async () => {
        const token = await identity.issueIdentityToken(
          (await signedIn('ana@example.com')).sessionToken,
        );
        const [head, body, signature] = token.split('.');
        const { claims } = decodeToken(token);
        const forgedBody = Buffer.from(
          JSON.stringify({ ...claims, org: '00000000-0000-4000-8000-000000000000' }),
        ).toString('base64url');
        const unsignedHead = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
          'base64url',
        );

        for (const bad of [
          `${head ?? ''}.${forgedBody}.${signature ?? ''}`,
          `${unsignedHead}.${body ?? ''}.`,
          `${head ?? ''}.${body ?? ''}`,
          'not a token',
        ]) {
          await expectAuthenticationError(identity.verifyIdentityToken(bad), 'invalid_token');
        }
      });

      it('rejects a token from another deployment', async () => {
        const other = await fixture.create();
        try {
          const { userId } = await other.identity.createUser({
            email: 'eve@example.com',
            name: 'Eve',
            password: PASSWORD,
          });
          await other.identity.createOrganization({
            name: 'Other',
            slug: 'other',
            ownerUserId: userId,
          });
          const { sessionToken } = await other.identity.signIn({
            email: 'eve@example.com',
            password: PASSWORD,
          });
          const foreign = await other.identity.issueIdentityToken(sessionToken);

          await expectAuthenticationError(identity.verifyIdentityToken(foreign), 'invalid_token');
        } finally {
          await other.dispose();
        }
      });

      it('is not issued to someone who belongs to no organization', async () => {
        await identity.createUser({
          email: 'loner@example.com',
          name: 'Loner',
          password: PASSWORD,
        });
        const { sessionToken } = await signedIn('loner@example.com');

        await expectAuthenticationError(
          identity.issueIdentityToken(sessionToken),
          'invalid_request',
        );
      });
    });

    describe('sign out', () => {
      it('ends the session: it issues no token and cannot be closed twice', async () => {
        const { sessionToken } = await signedIn('ana@example.com');

        await identity.signOut(sessionToken);

        await expectAuthenticationError(
          identity.issueIdentityToken(sessionToken),
          'session_not_found',
        );
        await expectAuthenticationError(identity.signOut(sessionToken), 'session_not_found');
      });
    });
  });
}
