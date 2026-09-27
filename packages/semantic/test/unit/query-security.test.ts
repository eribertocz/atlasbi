import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { QUERY_TOKEN } from '../../src/index.ts';

interface QuerySecurity {
  jwt: { algorithms: string[]; issuer: string[]; audience: string };
  contextToGroups(input: { securityContext: unknown }): string[];
  checkSqlAuth(
    request: unknown,
    user: string,
    password: unknown,
  ): { password: unknown; superuser: boolean; securityContext: Record<string, unknown> };
  queryRewrite(query: object, context: { securityContext: unknown }): object;
}

interface QuerySecurityModule {
  createQuerySecurity(dependencies: {
    verifyJwt: (token: string, secret: string, options: object) => Record<string, unknown>;
    secret: string;
    now?: () => number;
  }): QuerySecurity;
  QUERY_TOKEN: { issuer: string; audience: string; maxLifetimeSeconds: number };
  SQL_API_REFUSAL: string;
  EXPIRED: string;
}

// The CommonJS module Cube's container loads, tested as is. Signature checking itself is
// jsonwebtoken's (injected here); the integration tests run it inside the real Cube.
const module = createRequire(import.meta.url)(
  '../../cube/query-security.cjs',
) as QuerySecurityModule;

const NOW = 1_800_000_000;
const live = (lifetime = 300) => ({
  iss: 'platform-api',
  aud: 'semantic-layer',
  iat: NOW - 10,
  exp: NOW - 10 + lifetime,
  groups: ['region:all'],
});

function withoutExpiry(): Record<string, unknown> {
  const claims: Record<string, unknown> = live();
  delete claims.exp;
  return claims;
}

function security(claims: Record<string, unknown> | Error) {
  const calls: { token: string; options: object }[] = [];
  const instance = module.createQuerySecurity({
    verifyJwt: (token, secret, options) => {
      calls.push({ token, options });
      if (claims instanceof Error) {
        throw claims;
      }
      return claims;
    },
    secret: 'secret',
    now: () => NOW * 1000,
  });
  return { instance, calls };
}

describe("Cube's query security (cube/query-security.cjs)", () => {
  it('verifies exactly what the platform signs: same issuer, audience and maximum life', () => {
    expect(module.QUERY_TOKEN).toEqual(QUERY_TOKEN);
    expect(security(live()).instance.jwt).toEqual({
      algorithms: ['HS256'],
      issuer: ['platform-api'],
      audience: 'semantic-layer',
    });
  });

  it('opens the SQL API with a live query token as the password, pinned to HS256', () => {
    const { instance, calls } = security(live());

    const session = instance.checkSqlAuth({}, 'platform', 'a.token.value');

    expect(session).toEqual({
      password: 'a.token.value',
      superuser: false,
      securityContext: live(),
    });
    expect(calls[0]?.options).toEqual({
      algorithms: ['HS256'],
      issuer: 'platform-api',
      audience: 'semantic-layer',
    });
  });

  it('refuses the SQL API to a bad token, and to one that lives longer than five minutes', () => {
    expect(() =>
      security(new Error('invalid signature')).instance.checkSqlAuth({}, 'x', 't'),
    ).toThrow(module.SQL_API_REFUSAL);
    expect(() => security(live(3600)).instance.checkSqlAuth({}, 'x', 't')).toThrow(
      module.SQL_API_REFUSAL,
    );
    expect(() => security(withoutExpiry()).instance.checkSqlAuth({}, 'x', 't')).toThrow(
      module.SQL_API_REFUSAL,
    );
  });

  it('checks the expiry on every query: an open SQL connection does not outlive its token', () => {
    const { instance } = security(live());
    const query = { measures: ['sales_orders.total_amount'] };

    expect(instance.queryRewrite(query, { securityContext: live() })).toBe(query);
    for (const securityContext of [{ ...live(), exp: NOW - 1 }, live(3600), withoutExpiry()]) {
      expect(() => instance.queryRewrite(query, { securityContext })).toThrow(module.EXPIRED);
    }
  });

  it("lets Cube's own work through: pre-aggregation refreshes carry no security context", () => {
    const { instance } = security(live());
    const query = { measures: ['sales_orders.total_amount'] };

    expect(instance.queryRewrite(query, { securityContext: {} })).toBe(query);
    expect(instance.queryRewrite(query, { securityContext: undefined })).toBe(query);
  });

  it('reads the groups from the token, and nothing but strings', () => {
    const { instance } = security(live());

    expect(
      instance.contextToGroups({ securityContext: { groups: ['region:all', 7, null] } }),
    ).toEqual(['region:all']);
    expect(instance.contextToGroups({ securityContext: {} })).toEqual([]);
    expect(instance.contextToGroups({ securityContext: undefined })).toEqual([]);
  });
});
