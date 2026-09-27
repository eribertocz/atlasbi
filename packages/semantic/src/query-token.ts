import { createHmac } from 'node:crypto';

/**
 * The query token Cube accepts (cube/query-security.cjs verifies the same values — a unit test
 * keeps both in step). Neutral names: the codename never goes into a token (docs/21 §1).
 */
export const QUERY_TOKEN = {
  issuer: 'platform-api',
  audience: 'semantic-layer',
  /** Five minutes at most (build step 4, decision E3), for REST and the SQL API alike. */
  maxLifetimeSeconds: 300,
} as const;

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * A short-lived HS256 token for Cube, signed with the secret Cube verifies (semantic.api-secret).
 * The claims become Cube's security context; the issuer, audience and times are always the
 * platform's, whatever the claims say.
 */
export function signQueryToken(
  apiSecret: string,
  claims: object,
  lifetimeSeconds: number = QUERY_TOKEN.maxLifetimeSeconds,
): string {
  if (
    !Number.isInteger(lifetimeSeconds) ||
    lifetimeSeconds <= 0 ||
    lifetimeSeconds > QUERY_TOKEN.maxLifetimeSeconds
  ) {
    throw new RangeError(
      `A query token lives 1 to ${QUERY_TOKEN.maxLifetimeSeconds} seconds, not ${lifetimeSeconds}`,
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const head = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode({
    ...claims,
    iss: QUERY_TOKEN.issuer,
    aud: QUERY_TOKEN.audience,
    iat: now,
    exp: now + lifetimeSeconds,
  });
  const signature = createHmac('sha256', apiSecret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}
