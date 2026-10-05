import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { IdentityHttpHandler, IdentityHttpOperation } from '../auth/identity-http.ts';
import type { Identity } from '../auth/identity-port.ts';

/** One deployment's HTTP surface, with a single person who belongs to exactly one organization. */
export interface IdentityHttpDeployment {
  http: IdentityHttpHandler;
  account: { email: string; password: string };
  /** Verifies an identity token the way the API gateway does. */
  verifyIdentityToken(token: string): Promise<Identity>;
  dispose(): Promise<void>;
}

export interface IdentityHttpFixture {
  /** A new deployment that trusts `publicUrl` as the only Origin. */
  create(options: { publicUrl: string }): Promise<IdentityHttpDeployment>;
}

const PUBLIC_URL = 'http://127.0.0.1:4100';
const SECURE_PUBLIC_URL = 'https://bi.example.com';

const cookiePairs = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

/**
 * The battery every IdentityHttpHandler adapter must pass (docs/21 §3.3, docs/06 §6.4): three
 * operations, cleaned answers, the cookie as the only session credential. Cookie names are the
 * adapter's: only their attributes are checked here.
 */
export function describeIdentityHttpContract(
  adapterName: string,
  fixture: IdentityHttpFixture,
): void {
  describe(`IdentityHttpHandler contract: ${adapterName}`, () => {
    let deployment: IdentityHttpDeployment;

    const call = (
      operation: IdentityHttpOperation,
      init: { method: string; headers?: Record<string, string>; body?: string },
      target: IdentityHttpDeployment = deployment,
      url = PUBLIC_URL,
    ) => target.http.handle(operation, new Request(`${url}/auth/${operation}`, init));
    const signIn = (
      credentials: unknown,
      headers: Record<string, string> = { origin: PUBLIC_URL, 'content-type': 'application/json' },
    ) =>
      call('sign-in', {
        method: 'POST',
        headers,
        body: typeof credentials === 'string' ? credentials : JSON.stringify(credentials),
      });
    const token = (cookie?: string) =>
      call('token', { method: 'GET', ...(cookie === undefined ? {} : { headers: { cookie } }) });
    const failureCode = async (response: Response) => {
      const body = (await response.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['code', 'message']);
      return body.code;
    };

    beforeAll(async () => {
      deployment = await fixture.create({ publicUrl: PUBLIC_URL });
    });

    afterAll(async () => {
      await deployment?.dispose();
    });

    it('signs in: {} and an HttpOnly, SameSite cookie, never the session token in the body', async () => {
      const { email, password } = deployment.account;

      const response = await signIn({ email: ` ${email.toUpperCase()} `, password });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
      expect(response.headers.get('cache-control')).toBe('no-store');
      const [cookie] = response.headers.getSetCookie();
      expect(cookie).toMatch(/; HttpOnly/i);
      expect(cookie).toMatch(/; SameSite=(Lax|Strict)/i);
      expect(cookie).not.toMatch(/; Secure/i);
    });

    it('answers every wrong email or password alike, without a cookie', async () => {
      const { email, password } = deployment.account;
      const answers = [
        await signIn({ email, password: 'not the password at all' }),
        await signIn({ email: 'nobody@example.com', password }),
      ];

      const bodies: string[] = [];
      for (const response of answers) {
        expect(response.status).toBe(401);
        expect(response.headers.getSetCookie()).toEqual([]);
        bodies.push(await response.clone().text());
        expect(await failureCode(response)).toBe('invalid_credentials');
      }
      expect(bodies[0]).toBe(bodies[1]);
    });

    it('refuses a malformed sign-in', async () => {
      const { email, password } = deployment.account;
      for (const response of [
        await signIn({ email: 'not-an-email', password }),
        await signIn({ email }),
        await signIn(`email=${email}`, { origin: PUBLIC_URL, 'content-type': 'text/plain' }),
        await signIn('{not json', { origin: PUBLIC_URL, 'content-type': 'application/json' }),
      ]) {
        expect(response.status).toBe(400);
        expect(await failureCode(response)).toBe('invalid_request');
      }
    });

    it('refuses a foreign Origin, and the wrong method', async () => {
      const { email, password } = deployment.account;
      const foreign = await signIn(
        { email, password },
        { origin: 'http://evil.example', 'content-type': 'application/json' },
      );
      const wrongMethod = await call('token', { method: 'POST' });

      expect(foreign.status).toBe(403);
      expect(await failureCode(foreign)).toBe('forbidden_origin');
      expect(wrongMethod.status).toBe(405);
    });

    it('turns the session cookie into an identity token, and nothing else into one', async () => {
      const { email, password } = deployment.account;
      const cookie = cookiePairs(await signIn({ email, password }));

      const issued = await token(cookie);
      const body = (await issued.json()) as { token: string };

      expect(issued.status).toBe(200);
      expect(Object.keys(body)).toEqual(['token']);
      await expect(deployment.verifyIdentityToken(body.token)).resolves.toMatchObject({
        userId: expect.any(String) as string,
        organizationId: expect.any(String) as string,
      });
      for (const response of [await token(), await token(`${cookie.split('=')[0]}=forged.value`)]) {
        expect(response.status).toBe(401);
        expect(await failureCode(response)).toBe('session_not_found');
      }
    });

    it('signs out: the cookie is cleared, and the session gives no token anymore', async () => {
      const { email, password } = deployment.account;
      const cookie = cookiePairs(await signIn({ email, password }));

      const response = await call('sign-out', {
        method: 'POST',
        headers: { origin: PUBLIC_URL, cookie },
      });

      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie().join()).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
      expect((await token(cookie)).status).toBe(401);
    });

    it('makes the cookie Secure behind an https address', async () => {
      const secure = await fixture.create({ publicUrl: SECURE_PUBLIC_URL });
      try {
        const { email, password } = secure.account;
        const response = await call(
          'sign-in',
          {
            method: 'POST',
            headers: { origin: SECURE_PUBLIC_URL, 'content-type': 'application/json' },
            body: JSON.stringify({ email, password }),
          },
          secure,
          SECURE_PUBLIC_URL,
        );

        expect(response.status).toBe(200);
        expect(response.headers.getSetCookie()[0]).toMatch(/; Secure/i);
      } finally {
        await secure.dispose();
      }
    });
  });
}
