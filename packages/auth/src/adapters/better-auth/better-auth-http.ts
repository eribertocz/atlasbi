import type { IdentityHttpHandler, IdentityHttpOperation } from '@atlasbi/contracts';
import { betterAuth } from 'better-auth';
import { decodeJwt } from 'jose';
import pg from 'pg';

import { AUTH_BASE_PATH, createAuthOptions, MAX_PASSWORD_LENGTH } from './auth-options.ts';

export interface BetterAuthHttpOptions {
  /** The platform database (secret `database.url`). */
  connectionString: string;
  /** Secret `auth.secret`. */
  secret: string;
  /**
   * The address the browser uses (ATLASBI_PUBLIC_URL): the only trusted Origin, and what decides
   * whether the session cookie is `Secure` (it is on https).
   */
  publicUrl: string;
}

/** The only better-auth routes the platform answers — every other one stays unreachable (G4). */
const ROUTES: Record<IdentityHttpOperation, { method: 'GET' | 'POST'; path: string }> = {
  'sign-in': { method: 'POST', path: '/sign-in/email' },
  'sign-out': { method: 'POST', path: '/sign-out' },
  token: { method: 'GET', path: '/token' },
};

/** Request headers better-auth needs; nothing else is passed on (no IP, no user agent). */
const FORWARDED_HEADERS = ['cookie', 'origin', 'content-type'];
const MAX_EMAIL_LENGTH = 320;

/**
 * The identity layer's HTTP surface over better-auth (build step 5, decision G4). better-auth's
 * routes, response bodies and error codes stay in here: a sign-in answers `{}` and the cookie —
 * never better-auth's body, which carries the raw session token and the user record (P5-2).
 */
export function createBetterAuthHttp(options: BetterAuthHttpOptions): IdentityHttpHandler {
  const origin = new URL(options.publicUrl).origin;
  const pool = new pg.Pool({ connectionString: options.connectionString, max: 5 });
  const auth = betterAuth({
    ...createAuthOptions({ pool, secret: options.secret }),
    basePath: AUTH_BASE_PATH,
    baseURL: origin,
    trustedOrigins: [origin],
  });

  return {
    async handle(operation, request) {
      const route = ROUTES[operation];
      if (request.method !== route.method) {
        return failure(405, 'method_not_allowed', `Use ${route.method}.`);
      }
      const headers = new Headers();
      for (const name of FORWARDED_HEADERS) {
        const value = request.headers.get(name);
        if (value !== null) {
          headers.set(name, value);
        }
      }
      let body: string | undefined;
      if (operation === 'sign-in') {
        const credentials = await readCredentials(request);
        if (credentials === undefined) {
          return failure(400, 'invalid_request', 'Sign in with an email and a password.');
        }
        headers.set('content-type', 'application/json');
        body = JSON.stringify(credentials);
      } else if (route.method === 'POST') {
        headers.set('content-type', 'application/json');
        body = '{}';
      }
      const response = await auth.handler(
        new Request(`${origin}${AUTH_BASE_PATH}${route.path}`, {
          method: route.method,
          headers,
          ...(body === undefined ? {} : { body }),
        }),
      );
      return translate(operation, response);
    },

    async close() {
      await pool.end();
    },
  };
}

async function translate(operation: IdentityHttpOperation, response: Response): Promise<Response> {
  const cookies = response.headers.getSetCookie();
  const payload = (await response.json().catch(() => ({}))) as {
    code?: unknown;
    token?: unknown;
  };
  if (response.status === 403 && payload.code === 'INVALID_ORIGIN') {
    return failure(403, 'forbidden_origin', 'This request does not come from the platform.');
  }
  if (response.status >= 500) {
    return failure(500, 'internal_error', 'Identity is unavailable.');
  }
  switch (operation) {
    case 'sign-in':
      if (response.ok) {
        return success({}, cookies);
      }
      // Wrong email and wrong password look the same; so does a malformed email.
      return response.status === 400
        ? failure(400, 'invalid_request', 'Sign in with an email and a password.')
        : failure(401, 'invalid_credentials', 'Invalid email or password.');
    case 'sign-out':
      return response.ok
        ? success({}, cookies)
        : failure(401, 'session_not_found', 'There is no session to close.');
    case 'token': {
      if (!response.ok || typeof payload.token !== 'string') {
        return failure(401, 'session_not_found', 'Sign in again.');
      }
      // Same rule as IdentityPort.issueIdentityToken: a token names exactly one organization.
      if (typeof decodeJwt(payload.token).org !== 'string') {
        return failure(
          403,
          'no_organization',
          'This person belongs to no organization, or to several: an identity token names exactly one.',
        );
      }
      return success({ token: payload.token }, cookies);
    }
  }
}

async function readCredentials(
  request: Request,
): Promise<{ email: string; password: string } | undefined> {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return undefined;
  }
  const value: unknown = await request.json().catch(() => undefined);
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const { email, password } = value as Record<string, unknown>;
  if (
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    email.length > MAX_EMAIL_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return undefined;
  }
  return { email: email.trim().toLowerCase(), password };
}

function success(body: object, cookies: readonly string[]): Response {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  for (const cookie of cookies) {
    headers.append('set-cookie', cookie);
  }
  return new Response(JSON.stringify(body), { status: 200, headers });
}

function failure(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
