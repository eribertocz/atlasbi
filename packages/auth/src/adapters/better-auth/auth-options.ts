import type { BetterAuthOptions } from 'better-auth';
import { jwt, organization } from 'better-auth/plugins';
import { Kysely, PostgresDialect } from 'kysely';
import type pg from 'pg';

/** Postgres schema of better-auth's own tables — vendor storage, only this adapter reads it. */
export const AUTH_SCHEMA = 'auth';

/**
 * The identity token's issuer and audience. Neutral names: the codename never goes into a token
 * (docs/21 §1).
 */
export const IDENTITY_TOKEN_ISSUER = 'identity';
export const IDENTITY_TOKEN_AUDIENCE = 'platform-api';
export const IDENTITY_TOKEN_LIFETIME = '15m';

/** Where the identity layer's HTTP surface is mounted, and better-auth's own base path. */
export const AUTH_BASE_PATH = '/auth';

/** Session cookies are `identity.session_token`: never a vendor name on a public surface. */
export const COOKIE_PREFIX = 'identity';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;
const MIN_SECRET_LENGTH = 32;

export interface AuthOptionsInput {
  pool: pg.Pool;
  secret: string;
}

/**
 * The single better-auth configuration of the platform: the runtime and the schema contract test
 * build it here, so the committed migration (000001_auth_schema.sql) is exactly its schema.
 *
 * - email and password only, public sign-up disabled (docs/09 §8, decision D5);
 * - organization plugin without teams (docs/09 §6.2); no invitations are sent (no email yet);
 * - jwt plugin: the identity token carries `sub` and `org` only, never a role or an entitlement
 *   (docs/09 §7) — without `definePayload` it would carry the whole user (Phase 0, P4-5);
 * - UUID ids, tables in the `auth` schema, telemetry off (decisions D2, D7, E4);
 * - better-auth's own rate limiter off, always: it turns itself on with NODE_ENV=production and,
 *   without a client IP, shares one bucket per route — three wrong passwords from anyone locked
 *   everyone out (build step 5, P5-10). The API gateway limits sign-in instead (docs/06 §6.3);
 * - its Origin (CSRF) check on, always: no security switch depends on NODE_ENV.
 */
export function createAuthOptions(input: AuthOptionsInput) {
  if (input.secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`auth.secret must have at least ${MIN_SECRET_LENGTH} characters`);
  }
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: input.pool }) });
  return {
    database: { db, type: 'postgres', schemaName: AUTH_SCHEMA },
    secret: input.secret,
    telemetry: { enabled: false },
    // Messages only, never the arguments: better-auth may pass request data along with them.
    logger: {
      level: 'error',
      log: (level: string, message: string) => {
        if (level === 'error') {
          console.error(`[identity] ${message}`);
        }
      },
    },
    advanced: {
      database: { generateId: 'uuid' },
      cookiePrefix: COOKIE_PREFIX,
      // Explicit, always: left out, better-auth skips its Origin (CSRF) check whenever
      // NODE_ENV=test or any TEST variable is set — silently (build step 5, phase B).
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    rateLimit: { enabled: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    databaseHooks: {
      session: {
        create: {
          // The identity token's `org` comes from here. In the MVP a person belongs to exactly one
          // organization; with none or several it stays null and the token resolves no workspace.
          before: async (session: { userId: string } & Record<string, unknown>) => {
            const memberships = await db
              .withSchema(AUTH_SCHEMA)
              .selectFrom('member' as never)
              .select('organizationId' as never)
              .where('userId' as never, '=', session.userId as never)
              .execute();
            const organizationId =
              memberships.length === 1
                ? (memberships[0] as { organizationId: string }).organizationId
                : null;
            return { data: { ...session, activeOrganizationId: organizationId } };
          },
        },
      },
    },
    plugins: [
      organization({ teams: { enabled: false } }),
      jwt({
        jwt: {
          issuer: IDENTITY_TOKEN_ISSUER,
          audience: IDENTITY_TOKEN_AUDIENCE,
          expirationTime: IDENTITY_TOKEN_LIFETIME,
          definePayload: ({ session }) => ({
            org: (session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null,
          }),
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}
