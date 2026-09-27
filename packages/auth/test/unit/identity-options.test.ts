import { AuthenticationError } from '@atlasbi/contracts';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createAuthOptions } from '../../src/adapters/better-auth/auth-options.ts';
import { toIdentity } from '../../src/adapters/better-auth/identity-claims.ts';

const USER = '44444444-4444-4444-8444-444444444444';
const ORG = '11111111-1111-4111-8111-111111111111';
const STANDARD = { iss: 'identity', aud: 'platform-api', iat: 1, exp: 2 };

function invalid(payload: Record<string, unknown>): boolean {
  try {
    toIdentity(payload);
    return false;
  } catch (error) {
    return error instanceof AuthenticationError && error.code === 'invalid_token';
  }
}

describe('the identity token claims', () => {
  it('are the user and the organization, and nothing else', () => {
    expect(toIdentity({ ...STANDARD, sub: USER, org: ORG })).toEqual({
      userId: USER,
      organizationId: ORG,
    });
  });

  it('make the token invalid with a role, an entitlement or any other claim', () => {
    expect(invalid({ ...STANDARD, sub: USER, org: ORG, workspaceRole: 'admin' })).toBe(true);
    expect(invalid({ ...STANDARD, sub: USER, org: ORG, entitlements: {} })).toBe(true);
    expect(invalid({ ...STANDARD, sub: USER, org: ORG, email: 'ana@example.com' })).toBe(true);
  });

  it('make the token invalid without an organization, or with ids that are not UUIDs', () => {
    expect(invalid({ ...STANDARD, sub: USER, org: null })).toBe(true);
    expect(invalid({ ...STANDARD, sub: USER })).toBe(true);
    expect(invalid({ ...STANDARD, sub: 'someone', org: ORG })).toBe(true);
  });
});

describe('the better-auth configuration', () => {
  // Never connected: building the options opens nothing.
  const pool = new pg.Pool({ connectionString: 'postgres://unused@127.0.0.1:1/unused' });

  afterAll(async () => {
    await pool.end();
  });

  it('refuses a short secret', () => {
    expect(() => createAuthOptions({ pool, secret: 'short' })).toThrow(/at least 32 characters/);
  });

  it('keeps the plugin set minimal: organization and jwt — no admin, no teams, no sign-up', () => {
    const options = createAuthOptions({ pool, secret: 'x'.repeat(40) });

    expect(options.plugins.map((plugin) => plugin.id)).toEqual(['organization', 'jwt']);
    expect(options.emailAndPassword).toMatchObject({ disableSignUp: true, minPasswordLength: 12 });
    expect(options.telemetry).toEqual({ enabled: false });
    expect(options.advanced.database.generateId).toBe('uuid');
    expect(options.database.schemaName).toBe('auth');
  });
});
