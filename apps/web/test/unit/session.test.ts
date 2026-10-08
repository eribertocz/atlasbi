import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RENEW_AT_SHARE_OF_LIFETIME, Session } from '../../src/lib/session/session.svelte.ts';

/** A compact JWS whose claims say it lives `lifetime` seconds; only its timing matters here. */
function tokenLiving(lifetime: number, label = 'token'): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'EdDSA' })}.${encode({ iat: 1_000, exp: 1_000 + lifetime, sub: label })}.c2ln`;
}

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake of the gateway's /auth routes, keyed "METHOD path"; records every call. */
function gateway(answers: [string, () => Response][]) {
  const routes = new Map(answers);
  const calls: string[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${input instanceof Request ? input.url : input.toString()}`;
    calls.push(key);
    const answer = routes.get(key);
    return Promise.resolve(answer === undefined ? new Response(null, { status: 404 }) : answer());
  };
  return { fetch, calls };
}

describe('the session of a tab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('signs in, keeps the token in memory and renews it at 80 % of its lifetime', async () => {
    let issued = 0;
    const { fetch, calls } = gateway([
      ['POST /auth/sign-in/email', () => json(200, {})],
      ['GET /auth/token', () => json(200, { token: tokenLiving(900, `t${++issued}`) })],
    ]);
    const session = new Session({ fetch });

    await expect(session.signIn('ana@example.com', 'secret')).resolves.toBe('signed-in');
    expect(session.status).toBe('signed-in');
    const first = session.token;

    await vi.advanceTimersByTimeAsync(900 * 1_000 * RENEW_AT_SHARE_OF_LIFETIME - 1);
    expect(session.token).toBe(first);
    await vi.advanceTimersByTimeAsync(1);

    expect(session.token).not.toBe(first);
    expect(calls).toEqual(['POST /auth/sign-in/email', 'GET /auth/token', 'GET /auth/token']);
  });

  it('says why a sign-in failed, without a token', async () => {
    for (const [status, outcome] of [
      [401, 'invalid-credentials'],
      [429, 'too-many-attempts'],
      [503, 'unavailable'],
    ] as const) {
      const session = new Session({
        fetch: gateway([['POST /auth/sign-in/email', () => json(status, {})]]).fetch,
      });

      await expect(session.signIn('ana@example.com', 'wrong')).resolves.toBe(outcome);
      expect(session.token).toBeUndefined();
    }
  });

  it('shares one renewal between concurrent callers, and signs out when the cookie is gone', async () => {
    const { fetch, calls } = gateway([['GET /auth/token', () => json(401, {})]]);
    const session = new Session({ fetch });

    const results = await Promise.all([session.renew(), session.renew(), session.renew()]);

    expect(results).toEqual([false, false, false]);
    expect(calls).toEqual(['GET /auth/token']);
    expect(session.status).toBe('signed-out');
  });

  it('forgets the token and stops renewing on sign-out', async () => {
    const { fetch, calls } = gateway([
      ['GET /auth/token', () => json(200, { token: tokenLiving(900) })],
      ['POST /auth/sign-out', () => json(200, {})],
    ]);
    const session = new Session({ fetch });
    await session.restore();

    await session.signOut();
    await vi.advanceTimersByTimeAsync(900 * 1_000);

    expect(session.token).toBeUndefined();
    expect(session.status).toBe('signed-out');
    expect(calls).toEqual(['GET /auth/token', 'POST /auth/sign-out']);
  });
});
