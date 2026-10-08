import { describe, expect, it } from 'vitest';

import { createApiClient } from '../../src/lib/api/client.ts';

const ME = { userId: 'u', organizationId: 'o', workspaces: [] };
const answer = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Seen {
  method: string;
  url: string;
  authorization: string | null;
}

describe('the API client', () => {
  it('sends the identity token, by POST, one request per call', async () => {
    const seen: Seen[] = [];
    const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        method: init?.method ?? 'GET',
        url: input instanceof Request ? input.url : input.toString(),
        authorization: new Headers(init?.headers).get('authorization'),
      });
      return Promise.resolve(answer(200, { result: { data: ME } }));
    };
    const client = createApiClient(
      { token: 'identity-token', renew: () => Promise.resolve(true) },
      { fetch, url: 'http://web/api/trpc' },
    );

    await Promise.all([client.session.me.query(), client.session.me.query()]);

    const expected: Seen = {
      method: 'POST',
      url: 'http://web/api/trpc/session.me',
      authorization: 'Bearer identity-token',
    };
    expect(seen).toEqual([expected, expected]);
  });

  it('renews the token once on 401 and repeats the call', async () => {
    let token = 'expired';
    let calls = 0;
    let renewals = 0;
    const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      return Promise.resolve(
        new Headers(init?.headers).get('authorization') === 'Bearer fresh'
          ? answer(200, { result: { data: ME } })
          : answer(401, { error: { message: 'Sign in again.' } }),
      );
    };
    const session = {
      get token() {
        return token;
      },
      renew: () => {
        renewals += 1;
        token = 'fresh';
        return Promise.resolve(true);
      },
    };
    const client = createApiClient(session, {
      fetch,
      url: 'http://web/api/trpc',
    });

    await expect(client.session.me.query()).resolves.toEqual(ME);
    expect(renewals).toBe(1);
    expect(calls).toBe(2);
  });

  it('gives up after one renewal: a second 401 is the answer', async () => {
    let calls = 0;
    const fetch = () => {
      calls += 1;
      return Promise.resolve(answer(401, { error: { message: 'Sign in again.' } }));
    };
    const client = createApiClient(
      { token: 'expired', renew: () => Promise.resolve(true) },
      { fetch, url: 'http://web/api/trpc' },
    );

    await expect(client.session.me.query()).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
