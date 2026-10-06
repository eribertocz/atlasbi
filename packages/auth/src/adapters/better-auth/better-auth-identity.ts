import {
  AuthenticationError,
  type Identity,
  type IdentityPort,
  type NewUser,
} from '@atlasbi/contracts';
import { betterAuth } from 'better-auth';
import { isAPIError } from 'better-auth/api';
import { createLocalJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import pg from 'pg';
import { z } from 'zod';

import {
  createAuthOptions,
  IDENTITY_TOKEN_AUDIENCE,
  IDENTITY_TOKEN_ISSUER,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from './auth-options.ts';
import { toIdentity } from './identity-claims.ts';
import { createPlatformIdentity } from './platform-identity.ts';

export interface BetterAuthIdentityOptions {
  /** The platform database (secret `database.url`); better-auth's tables live in its `auth` schema. */
  connectionString: string;
  /** Secret `auth.secret`: signs sessions and encrypts the identity token's private keys. */
  secret: string;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const newUserSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

/**
 * IdentityPort over better-auth (docs/21 §3): no better-auth type, error or object leaves this
 * file. Users are created through better-auth's internal adapter — public sign-up is disabled, and
 * the admin plugin would expose ~20 /admin/* endpoints over HTTP (build step 4, decision E1) — so
 * the validation better-auth's sign-up would do happens here.
 */
export function createBetterAuthIdentity(options: BetterAuthIdentityOptions): IdentityPort {
  const pool = new pg.Pool({ connectionString: options.connectionString, max: 5 });
  const auth = betterAuth(createAuthOptions({ pool, secret: options.secret }));
  const platformIdentity = createPlatformIdentity(pool);
  let keySet: ReturnType<typeof createLocalJWKSet> | undefined;

  async function sessionHeaders(sessionToken: string): Promise<Headers> {
    const { authCookies } = await auth.$context;
    return new Headers({ cookie: `${authCookies.sessionToken.name}=${sessionToken}` });
  }

  async function loadKeySet(): Promise<ReturnType<typeof createLocalJWKSet>> {
    keySet = createLocalJWKSet(await auth.api.getJwks());
    return keySet;
  }

  async function verify(token: string): Promise<JWTPayload> {
    const attempt = async (keys: ReturnType<typeof createLocalJWKSet>) =>
      (
        await jwtVerify(token, keys, {
          algorithms: ['EdDSA'],
          issuer: IDENTITY_TOKEN_ISSUER,
          audience: IDENTITY_TOKEN_AUDIENCE,
          requiredClaims: ['iat', 'exp', 'sub', 'org'],
        })
      ).payload;
    try {
      return await attempt(keySet ?? (await loadKeySet()));
    } catch (error) {
      // A key created since the last load (first token, rotation): reload once, then give up.
      if ((error as { code?: string }).code === 'ERR_JWKS_NO_MATCHING_KEY') {
        return attempt(await loadKeySet());
      }
      throw error;
    }
  }

  return {
    async createUser(user: NewUser) {
      const parsed = newUserSchema.safeParse({ ...user, email: normalizeEmail(user.email) });
      if (!parsed.success) {
        throw new AuthenticationError(
          'invalid_request',
          `A user needs a valid email, a name, and a password of ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`,
        );
      }
      const { email, name, password } = parsed.data;
      const context = await auth.$context;
      if (await context.internalAdapter.findUserByEmail(email)) {
        throw new AuthenticationError('invalid_request', 'A user with this email already exists.');
      }
      // Not verified: the platform sends no email yet (docs/09 §8). Provisioned by an
      // administrative action — the same method better-auth's admin plugin declares.
      const created = await context.internalAdapter.createUser(
        { email, name, emailVerified: false },
        { method: 'admin' },
      );
      try {
        await context.internalAdapter.linkAccount({
          userId: created.id,
          providerId: 'credential',
          accountId: created.id,
          password: await context.password.hash(password),
        });
        // The platform's own record of the person (docs/09 §6.4); without it, no membership.
        await platformIdentity.recordPrincipal(created.id);
      } catch (error) {
        await context.internalAdapter.deleteUser(created.id);
        throw error;
      }
      return { userId: created.id };
    },

    async findUserByEmail(email) {
      const found = await (
        await auth.$context
      ).internalAdapter.findUserByEmail(normalizeEmail(email));
      return found ? { userId: found.user.id } : undefined;
    },

    async createOrganization({ name, slug, ownerUserId }) {
      if (!SLUG.test(slug) || name.trim() === '') {
        throw new AuthenticationError(
          'invalid_request',
          'An organization needs a name and a slug.',
        );
      }
      try {
        const organization = await auth.api.createOrganization({
          body: { name: name.trim(), slug, userId: ownerUserId },
        });
        if (!organization) {
          throw new AuthenticationError('invalid_request', 'The organization was not created.');
        }
        try {
          await platformIdentity.recordOrganization(organization.id);
        } catch (error) {
          // Members go with it (ON DELETE CASCADE in better-auth's schema).
          await (
            await auth.$context
          ).adapter.delete({
            model: 'organization',
            where: [{ field: 'id', value: organization.id }],
          });
          throw error;
        }
        return { organizationId: organization.id };
      } catch (error) {
        throw toAuthenticationError(error, 'invalid_request', 'The organization was not created.');
      }
    },

    async findOrganizationBySlug(slug) {
      const found = await (
        await auth.$context
      ).adapter.findOne<{ id: string }>({
        model: 'organization',
        where: [{ field: 'slug', value: slug }],
      });
      return found ? { organizationId: found.id } : undefined;
    },

    async addOrganizationMember({ organizationId, userId }) {
      const existing = await (
        await auth.$context
      ).adapter.findOne({
        model: 'member',
        where: [
          { field: 'organizationId', value: organizationId },
          { field: 'userId', value: userId },
        ],
      });
      if (existing) {
        return;
      }
      try {
        await auth.api.addMember({ body: { organizationId, userId, role: 'member' } });
      } catch (error) {
        throw toAuthenticationError(error, 'invalid_request', 'The member was not added.');
      }
    },

    async signIn({ email, password }) {
      try {
        const { headers } = await auth.api.signInEmail({
          body: { email: normalizeEmail(email), password },
          returnHeaders: true,
        });
        const { authCookies } = await auth.$context;
        const sessionToken = readCookie(headers.get('set-cookie'), authCookies.sessionToken.name);
        if (sessionToken === undefined) {
          throw new AuthenticationError('invalid_credentials', 'Invalid email or password.');
        }
        return { sessionToken };
      } catch (error) {
        // Every failure looks the same: never tell which of email or password was wrong.
        throw toAuthenticationError(error, 'invalid_credentials', 'Invalid email or password.');
      }
    },

    async signOut(sessionToken) {
      const headers = await sessionHeaders(sessionToken);
      if (!(await auth.api.getSession({ headers }))) {
        throw new AuthenticationError('session_not_found', 'The session does not exist.');
      }
      await auth.api.signOut({ headers });
    },

    async issueIdentityToken(sessionToken) {
      let token: string;
      try {
        ({ token } = await auth.api.getToken({ headers: await sessionHeaders(sessionToken) }));
      } catch (error) {
        throw toAuthenticationError(error, 'session_not_found', 'The session does not exist.');
      }
      if (typeof decodeJwt(token).org !== 'string') {
        throw new AuthenticationError(
          'invalid_request',
          'This person belongs to no organization, or to several: an identity token names exactly one.',
        );
      }
      return token;
    },

    async verifyIdentityToken(token): Promise<Identity> {
      let payload: JWTPayload;
      try {
        payload = await verify(token);
      } catch {
        throw new AuthenticationError('invalid_token', 'The identity token is not valid.');
      }
      return toIdentity(payload);
    },

    reconcile({ repair = false } = {}) {
      return platformIdentity.reconcile(repair);
    },

    async close() {
      await pool.end();
    },
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function readCookie(setCookie: string | null, name: string): string | undefined {
  for (const cookie of (setCookie ?? '').split(/,(?=\s*[^;,=\s]+=)/)) {
    const [pair] = cookie.split(';');
    const separator = pair?.indexOf('=') ?? -1;
    if (pair !== undefined && separator > 0 && pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }
  return undefined;
}

/** better-auth's own errors never cross the port; anything unexpected is rethrown as is. */
function toAuthenticationError(
  error: unknown,
  code: AuthenticationError['code'],
  message: string,
): unknown {
  if (error instanceof AuthenticationError) {
    return error;
  }
  return isAPIError(error) ? new AuthenticationError(code, message) : error;
}
