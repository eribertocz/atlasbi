import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SIGN_IN_LIMITS } from '../../src/index.ts';
import {
  ANA_PASSWORD,
  buildTestGateway,
  fakeDependencies,
  type FakeDependencies,
  PUBLIC_URL,
} from './support/fake-dependencies.ts';

const JSON_FROM_PLATFORM = { origin: PUBLIC_URL, 'content-type': 'application/json' };

describe('the identity routes (decision G4)', () => {
  let dependencies: FakeDependencies;
  let app: FastifyInstance;

  beforeEach(async () => {
    dependencies = fakeDependencies();
    app = await buildTestGateway(dependencies);
  });

  afterEach(async () => {
    await app.close();
  });

  const signIn = (
    credentials: object,
    options: { headers?: Record<string, string>; ip?: string } = {},
  ) =>
    app.inject({
      method: 'POST',
      url: '/auth/sign-in/email',
      headers: options.headers ?? JSON_FROM_PLATFORM,
      remoteAddress: options.ip ?? '10.0.0.1',
      payload: credentials,
    });

  it('forwards a sign-in from the platform, and the answer with its cookie', async () => {
    const response = await signIn({ email: 'ana@example.com', password: ANA_PASSWORD });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({});
    expect(response.headers['set-cookie']).toEqual([
      'identity.session_token=session; Path=/; HttpOnly; SameSite=Lax',
    ]);
    const [forwarded] = dependencies.identityHttp.received;
    expect(forwarded?.operation).toBe('sign-in');
    expect(forwarded?.request.method).toBe('POST');
    expect(forwarded?.request.headers.get('origin')).toBe(PUBLIC_URL);
    expect(JSON.parse(forwarded?.body ?? '')).toEqual({
      email: 'ana@example.com',
      password: ANA_PASSWORD,
    });
  });

  it('turns a token request with the session cookie into a token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/token',
      headers: { cookie: 'identity.session_token=session' },
    });

    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.json<object>())).toEqual(['token']);
  });

  it('answers 404 for every other route of the identity provider, without asking it (P5-2)', async () => {
    for (const [method, url] of [
      ['GET', '/auth/get-session'],
      ['GET', '/auth/list-sessions'],
      ['POST', '/auth/organization/create'],
      ['POST', '/auth/update-user'],
      ['POST', '/auth/sign-up/email'],
      ['GET', '/auth/jwks'],
      ['GET', '/auth/sign-in/email'],
      ['POST', '/auth/token'],
      ['GET', '/auth/sign-out'],
      ['GET', '/api/v1/metrics'],
    ] as const) {
      const response = await app.inject({
        method,
        url: `${url}?probe=<script>`,
        headers: { ...JSON_FROM_PLATFORM, cookie: 'identity.session_token=session' },
        ...(method === 'POST' ? { payload: {} } : {}),
      });

      expect(response.statusCode, `${method} ${url}`).toBe(404);
      // Neutral: Fastify's own 404 repeats the method and the URL.
      expect(response.json()).toEqual({ code: 'not_found', message: 'Not found.' });
    }
    expect(dependencies.identityHttp.received).toEqual([]);
  });

  it('refuses a POST without Origin, or from another one, before reading it (G4)', async () => {
    for (const headers of [
      { 'content-type': 'application/json' },
      { 'content-type': 'application/json', origin: 'http://evil.example' },
      { 'content-type': 'application/json', origin: `${PUBLIC_URL}/` },
      { 'content-type': 'application/json', origin: 'null' },
    ]) {
      const signInResponse = await signIn(
        { email: 'ana@example.com', password: ANA_PASSWORD },
        { headers },
      );
      const signOutResponse = await app.inject({ method: 'POST', url: '/auth/sign-out', headers });

      for (const response of [signInResponse, signOutResponse]) {
        expect(response.statusCode, JSON.stringify(headers)).toBe(403);
        expect(response.json()).toEqual({
          code: 'forbidden_origin',
          message: 'This request does not come from the platform.',
        });
      }
    }
    expect(dependencies.identityHttp.received).toEqual([]);
  });

  it('refuses a sign-in body far larger than credentials', async () => {
    const response = await signIn({ email: 'ana@example.com', password: 'x'.repeat(8 * 1024) });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      code: 'payload_too_large',
      message: 'The request is too large.',
    });
    expect(dependencies.identityHttp.received).toEqual([]);
  });

  it('answers "Internal error" when the identity layer fails, never its message', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    dependencies.identityHttp.failNextWith = new Error(
      'connect ECONNREFUSED 10.89.1.5:5432 password=hunter2',
    );

    const response = await signIn({ email: 'ana@example.com', password: ANA_PASSWORD });

    expect(response.statusCode).toBe(500);
    expect(response.body).toBe('{"code":"internal_error","message":"Internal error."}');
    // The operator still sees why.
    expect(report).toHaveBeenCalledWith(
      'api-gateway: POST /auth/sign-in/email failed:',
      expect.any(Error),
    );
    report.mockRestore();
  });

  describe('sign-in limits (docs/06 §6.3, P5-10)', () => {
    const WRONG = 'not the password at all';
    const tooMany = { code: 'too_many_requests', message: 'Too many attempts. Try again later.' };

    it('locks an account after 5 failed attempts from any IP — its owner included', async () => {
      const statuses: number[] = [];
      for (let attempt = 1; attempt <= SIGN_IN_LIMITS.failuresPerAccount.max; attempt++) {
        // The same account however it is written.
        const email = attempt % 2 === 0 ? ' ANA@Example.com ' : 'ana@example.com';
        statuses.push(
          (await signIn({ email, password: WRONG }, { ip: `10.0.1.${attempt}` })).statusCode,
        );
      }
      const owner = await signIn(
        { email: 'ana@example.com', password: ANA_PASSWORD },
        { ip: '10.0.2.1' },
      );
      const otherAccount = await signIn(
        { email: 'bruno@example.com', password: WRONG },
        { ip: '10.0.2.2' },
      );

      expect(statuses).toEqual([401, 401, 401, 401, 401]);
      expect(owner.statusCode).toBe(429);
      expect(owner.json()).toEqual(tooMany);
      expect(otherAccount.statusCode).toBe(401);
      expect(dependencies.identityHttp.received).toHaveLength(6);
    });

    it('does not count a correct password against the account', async () => {
      const statuses: number[] = [];
      for (let attempt = 1; attempt <= 4; attempt++) {
        statuses.push(
          (await signIn({ email: 'ana@example.com', password: WRONG }, { ip: `10.0.3.${attempt}` }))
            .statusCode,
        );
      }
      statuses.push(
        (await signIn({ email: 'ana@example.com', password: ANA_PASSWORD }, { ip: '10.0.3.9' }))
          .statusCode,
      );
      statuses.push(
        (await signIn({ email: 'ana@example.com', password: WRONG }, { ip: '10.0.3.10' }))
          .statusCode,
      );
      statuses.push(
        (await signIn({ email: 'ana@example.com', password: ANA_PASSWORD }, { ip: '10.0.3.11' }))
          .statusCode,
      );

      expect(statuses).toEqual([401, 401, 401, 401, 200, 401, 429]);
    });

    it('limits every attempt from one IP to 10 a minute, whatever the account', async () => {
      const statuses: number[] = [];
      for (let attempt = 1; attempt <= SIGN_IN_LIMITS.perIp.max + 1; attempt++) {
        statuses.push(
          (
            await signIn(
              { email: `user${attempt}@example.com`, password: WRONG },
              { ip: '10.0.4.4' },
            )
          ).statusCode,
        );
      }
      const otherIp = await signIn(
        { email: 'ana@example.com', password: ANA_PASSWORD },
        { ip: '10.0.4.5' },
      );

      expect(statuses.slice(0, SIGN_IN_LIMITS.perIp.max)).toEqual(Array(10).fill(401));
      expect(statuses.at(-1)).toBe(429);
      expect(otherIp.statusCode).toBe(200);
      expect(dependencies.identityHttp.received).toHaveLength(SIGN_IN_LIMITS.perIp.max + 1);
    });

    it('says nothing about which limit applies or when it ends', async () => {
      for (let attempt = 1; attempt <= SIGN_IN_LIMITS.perIp.max; attempt++) {
        await signIn({ email: 'ana@example.com', password: WRONG }, { ip: '10.0.5.5' });
      }
      const limited = await signIn(
        { email: 'ana@example.com', password: WRONG },
        { ip: '10.0.5.5' },
      );

      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toEqual(tooMany);
      expect(Object.keys(limited.headers).filter((name) => /retry|ratelimit/i.test(name))).toEqual(
        [],
      );
    });

    it('keeps the token renewal and the sign-out outside the limits', async () => {
      for (let attempt = 1; attempt <= SIGN_IN_LIMITS.perIp.max + 1; attempt++) {
        await signIn({ email: 'ana@example.com', password: WRONG }, { ip: '10.0.6.6' });
      }
      const token = await app.inject({
        method: 'GET',
        url: '/auth/token',
        remoteAddress: '10.0.6.6',
        headers: { cookie: 'identity.session_token=session' },
      });
      const signOut = await app.inject({
        method: 'POST',
        url: '/auth/sign-out',
        remoteAddress: '10.0.6.6',
        headers: { origin: PUBLIC_URL },
      });

      expect(token.statusCode).toBe(200);
      expect(signOut.statusCode).toBe(200);
    });
  });
});
