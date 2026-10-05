import type { IdentityHttpHandler, IdentityPort } from '@atlasbi/contracts';
import type { ThrowawayDatabase } from '@atlasbi/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBetterAuthHttp, createBetterAuthIdentity } from '../../src/index.ts';
import { createAuthDatabase, testSecret } from './support/auth-database.ts';

const PUBLIC_URL = 'http://127.0.0.1:4100';
const PASSWORD = 'correct horse battery staple';

// The identity layer's HTTP surface (build step 5, decision G4): three operations, cleaned answers.
describe('identity over HTTP (createBetterAuthHttp)', () => {
  let database: ThrowawayDatabase;
  let identity: IdentityPort;
  let http: IdentityHttpHandler;
  let secret: string;

  const signIn = (
    credentials: unknown,
    headers: Record<string, string> = { origin: PUBLIC_URL, 'content-type': 'application/json' },
    handler: IdentityHttpHandler = http,
    url = PUBLIC_URL,
  ) =>
    handler.handle(
      'sign-in',
      new Request(`${url}/auth/sign-in`, {
        method: 'POST',
        headers,
        body: typeof credentials === 'string' ? credentials : JSON.stringify(credentials),
      }),
    );
  const token = (cookie?: string) =>
    http.handle(
      'token',
      new Request(`${PUBLIC_URL}/auth/token`, cookie === undefined ? {} : { headers: { cookie } }),
    );
  const cookieOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');

  beforeAll(async () => {
    database = await createAuthDatabase();
    secret = testSecret();
    identity = createBetterAuthIdentity({ connectionString: database.connectionString, secret });
    const { userId } = await identity.createUser({
      email: 'ana@example.com',
      name: 'Ana',
      password: PASSWORD,
    });
    await identity.createOrganization({ name: 'Demo', slug: 'demo', ownerUserId: userId });
    http = createBetterAuthHttp({
      connectionString: database.connectionString,
      secret,
      publicUrl: PUBLIC_URL,
    });
  });

  afterAll(async () => {
    await http.close();
    await identity.close();
    await database.drop();
  });

  it('signs in with a neutral, HttpOnly, SameSite cookie — and no session token in the body', async () => {
    const response = await signIn({ email: ' ANA@example.com ', password: PASSWORD });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    const [cookie] = response.headers.getSetCookie();
    expect(cookie).toMatch(
      /^identity\.session_token=[^;]+; Max-Age=\d+; Path=\/; HttpOnly; SameSite=Lax$/,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers every wrong email or password alike', async () => {
    const wrongPassword = await signIn({ email: 'ana@example.com', password: 'not the password' });
    const unknownEmail = await signIn({ email: 'nobody@example.com', password: PASSWORD });

    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        code: 'invalid_credentials',
        message: 'Invalid email or password.',
      });
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it('refuses a malformed sign-in without asking better-auth', async () => {
    const cases = [
      await signIn({ email: 'not-an-email', password: PASSWORD }),
      await signIn({ email: 'ana@example.com' }),
      await signIn('email=ana@example.com', { origin: PUBLIC_URL, 'content-type': 'text/plain' }),
      await signIn('{not json', { origin: PUBLIC_URL, 'content-type': 'application/json' }),
    ];

    for (const response of cases) {
      expect(response.status).toBe(400);
      expect(((await response.json()) as { code: string }).code).toBe('invalid_request');
    }
  });

  it('refuses a foreign Origin', async () => {
    const response = await signIn(
      { email: 'ana@example.com', password: PASSWORD },
      { origin: 'http://evil.example', 'content-type': 'application/json' },
    );

    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('forbidden_origin');
  });

  it('refuses the wrong method', async () => {
    const response = await http.handle(
      'token',
      new Request(`${PUBLIC_URL}/auth/token`, { method: 'POST' }),
    );

    expect(response.status).toBe(405);
  });

  it('issues an identity token for the session cookie, and none without it', async () => {
    const cookie = cookieOf(await signIn({ email: 'ana@example.com', password: PASSWORD }));

    const issued = await token(cookie);
    const body = (await issued.json()) as { token: string };
    const missing = await token();
    const forged = await token('identity.session_token=forged.value');

    expect(issued.status).toBe(200);
    expect(Object.keys(body)).toEqual(['token']);
    await expect(identity.verifyIdentityToken(body.token)).resolves.toMatchObject({
      userId: expect.any(String) as string,
      organizationId: expect.any(String) as string,
    });
    expect(missing.status).toBe(401);
    expect(forged.status).toBe(401);
  });

  it('signs out: the cookie is cleared, and the session gives no token anymore', async () => {
    const cookie = cookieOf(await signIn({ email: 'ana@example.com', password: PASSWORD }));

    const response = await http.handle(
      'sign-out',
      new Request(`${PUBLIC_URL}/auth/sign-out`, {
        method: 'POST',
        headers: { origin: PUBLIC_URL, cookie },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().join()).toMatch(/identity\.session_token=; Max-Age=0/);
    expect((await token(cookie)).status).toBe(401);
  });

  it('makes the cookie Secure, with the __Secure- prefix, behind an https address', async () => {
    const secure = createBetterAuthHttp({
      connectionString: database.connectionString,
      secret,
      publicUrl: 'https://bi.example.com',
    });
    try {
      const response = await signIn(
        { email: 'ana@example.com', password: PASSWORD },
        { origin: 'https://bi.example.com', 'content-type': 'application/json' },
        secure,
        'https://bi.example.com',
      );

      expect(response.headers.getSetCookie()[0]).toMatch(
        /^__Secure-identity\.session_token=[^;]+;.*HttpOnly; Secure; SameSite=Lax$/,
      );
    } finally {
      await secure.close();
    }
  });
});
