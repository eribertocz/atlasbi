import { createHmac } from 'node:crypto';

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * A short-lived HS256 token for Cube's REST API, signed with the secret Cube verifies
 * (semantic.api-secret). The payload becomes Cube's security context: in build step 3 it only
 * names the caller; auth (steps 4–5) adds the workspace role and the data entitlements (docs/09 §6.1).
 */
export function signQueryToken(
  apiSecret: string,
  claims: Record<string, unknown>,
  lifetimeSeconds = 60,
): string {
  const now = Math.floor(Date.now() / 1000);
  const head = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode({ ...claims, iat: now, exp: now + lifetimeSeconds });
  const signature = createHmac('sha256', apiSecret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}
