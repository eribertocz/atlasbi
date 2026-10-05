import type { IdentityHttpHandler, IdentityPort } from '@atlasbi/contracts';
import type { ThrowawayDatabase } from '@atlasbi/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBetterAuthHttp, createBetterAuthIdentity } from '../../src/index.ts';
import { createAuthDatabase, testSecret } from './support/auth-database.ts';

const PASSWORD = 'correct horse battery staple';

// What only this adapter promises over HTTP: neutral cookie names, never the vendor's. What any
// identity provider must do is the IdentityHttpHandler contract battery (identity-contract.test.ts).
describe('identity over HTTP with better-auth (adapter specifics)', () => {
  let database: ThrowawayDatabase;
  let identity: IdentityPort;
  let secret: string;

  const signIn = (http: IdentityHttpHandler, url: string) =>
    http.handle(
      'sign-in',
      new Request(`${url}/auth/sign-in`, {
        method: 'POST',
        headers: { origin: url, 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ana@example.com', password: PASSWORD }),
      }),
    );

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
  });

  afterAll(async () => {
    await identity.close();
    await database.drop();
  });

  it.each([
    [
      'http://127.0.0.1:4100',
      /^identity\.session_token=[^;]+; Max-Age=\d+; Path=\/; HttpOnly; SameSite=Lax$/,
    ],
    [
      'https://bi.example.com',
      /^__Secure-identity\.session_token=[^;]+;.*HttpOnly; Secure; SameSite=Lax$/,
    ],
  ])('names the session cookie neutrally behind %s', async (url, expected) => {
    const http = createBetterAuthHttp({
      connectionString: database.connectionString,
      secret,
      publicUrl: url,
    });
    try {
      const [cookie] = (await signIn(http, url)).headers.getSetCookie();

      expect(cookie).toMatch(expected);
    } finally {
      await http.close();
    }
  });
});
