import { AuthenticationError, type Identity } from '@atlasbi/contracts';

/** Exactly what an identity token may carry (docs/09 §7): anything else makes it invalid. */
const IDENTITY_CLAIMS = new Set(['iss', 'aud', 'iat', 'exp', 'sub', 'org']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The identity in a signature-checked token payload. A role, an entitlement or any other claim
 * makes the whole token invalid: identity and authorization never travel together (docs/13 §5).
 */
export function toIdentity(payload: Record<string, unknown>): Identity {
  const unexpected = Object.keys(payload).filter((claim) => !IDENTITY_CLAIMS.has(claim));
  const { sub, org } = payload;
  if (
    unexpected.length > 0 ||
    typeof sub !== 'string' ||
    typeof org !== 'string' ||
    !UUID.test(sub) ||
    !UUID.test(org)
  ) {
    throw new AuthenticationError('invalid_token', 'The identity token is not valid.');
  }
  return { userId: sub, organizationId: org };
}
