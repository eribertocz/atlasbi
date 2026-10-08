import { SemanticRuntimeError, type SemanticRuntimeErrorCode } from '@atlasbi/contracts';
import { TRPCClientError } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_BATCH_SIZE } from '../../src/index.ts';
import {
  ANA,
  ANA_TOKEN,
  buildTestGateway,
  COMERCIAL,
  DENIED,
  fakeDependencies,
  type FakeDependencies,
  FINANZAS,
  MODEL,
  REPORT,
  RESULT,
  trpcClient,
} from './support/fake-dependencies.ts';

const QUERY = { measures: ['sales_orders.total_amount'], dimensions: ['sales_orders.region'] };

/** What the client gets from a failed call: the tRPC code, the HTTP status and the message. */
async function failure(call: Promise<unknown>) {
  const error = await call.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof TRPCClientError)) {
    throw new Error(`expected a tRPC error, got ${String(error)}`);
  }
  const data = error.data as { code: string; httpStatus: number; issues?: unknown };
  return { code: data.code, status: data.httpStatus, message: error.message, issues: data.issues };
}

describe('the internal BFF (tRPC)', () => {
  let dependencies: FakeDependencies;
  let app: FastifyInstance;

  beforeEach(async () => {
    dependencies = fakeDependencies();
    app = await buildTestGateway(dependencies);
  });

  afterEach(async () => {
    await app.close();
  });

  const asAna = () => trpcClient(app, `Bearer ${ANA_TOKEN}`);
  const post = (path: string, body: unknown, authorization = `Bearer ${ANA_TOKEN}`) =>
    app.inject({
      method: 'POST',
      url: `/api/trpc/${path}`,
      headers: { authorization, 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    });

  describe('identity on every call (decision G1)', () => {
    it("answers session.me with the identity and the person's workspaces", async () => {
      expect(await asAna().session.me.query()).toEqual({
        ...ANA,
        workspaces: [
          { workspaceId: COMERCIAL, slug: 'comercial', name: 'Comercial', role: 'admin' },
          { workspaceId: FINANZAS, slug: 'finanzas', name: 'Finanzas', role: 'viewer' },
        ],
      });
    });

    it('refuses a call without a valid Bearer identity token', async () => {
      for (const authorization of [
        undefined,
        '',
        ANA_TOKEN,
        `Basic ${ANA_TOKEN}`,
        'Bearer not-a-token',
        'Bearer eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJldmUifQ.Zm9yZ2Vk',
      ]) {
        expect(await failure(trpcClient(app, authorization).session.me.query())).toEqual({
          code: 'UNAUTHORIZED',
          status: 401,
          message: 'Sign in again.',
          issues: undefined,
        });
      }
    });
  });

  describe('the security context, per workspace and per call', () => {
    it('hands the semantic layer the context resolved for that workspace', async () => {
      expect(await asAna().semantic.meta.query({ workspaceId: FINANZAS })).toEqual(MODEL);
      expect(await asAna().semantic.query.query({ workspaceId: COMERCIAL, query: QUERY })).toEqual(
        RESULT,
      );

      expect(dependencies.semantic.calls).toEqual([
        {
          method: 'describe',
          context: expect.objectContaining({ ...ANA, workspaceId: FINANZAS }) as unknown,
        },
        {
          method: 'query',
          context: expect.objectContaining({ ...ANA, workspaceId: COMERCIAL }) as unknown,
          query: QUERY,
        },
      ]);
    });

    it('answers every denied workspace alike', async () => {
      const answers = [];
      for (const [, workspaceId] of DENIED) {
        answers.push(await failure(asAna().semantic.query.query({ workspaceId, query: QUERY })));
      }

      expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
      expect(answers[0]).toEqual({
        code: 'FORBIDDEN',
        status: 403,
        message: 'Access to this workspace is denied.',
        issues: undefined,
      });
      expect(dependencies.semantic.calls).toEqual([]);
    });

    it('says the semantic layer does not run where it does not (the portable tier)', async () => {
      await app.close();
      app = await buildTestGateway({ ...fakeDependencies(), semantic: undefined });

      expect(await failure(asAna().semantic.meta.query({ workspaceId: FINANZAS }))).toMatchObject({
        code: 'NOT_IMPLEMENTED',
        status: 501,
      });
    });
  });

  describe('reports (build step 6, Viewer mode)', () => {
    it('lists the reports of a workspace and opens one whole', async () => {
      const client = asAna();

      expect(await client.report.list.query({ workspaceId: COMERCIAL })).toEqual([
        { id: REPORT.id, name: 'Ventas' },
      ]);
      expect(
        await client.report.get.query({ workspaceId: COMERCIAL, reportId: REPORT.id }),
      ).toEqual(REPORT);
      expect(await client.report.list.query({ workspaceId: FINANZAS })).toEqual([]);
    });

    it('answers "not found" for a report outside the workspace asked for', async () => {
      expect(
        await failure(asAna().report.get.query({ workspaceId: FINANZAS, reportId: REPORT.id })),
      ).toMatchObject({ code: 'NOT_FOUND', status: 404, message: 'Report not found.' });
    });

    it('reads no report of a workspace the person may not enter', async () => {
      for (const [, workspaceId] of DENIED) {
        expect(await failure(asAna().report.list.query({ workspaceId }))).toMatchObject({
          code: 'FORBIDDEN',
          message: 'Access to this workspace is denied.',
        });
        expect(
          await failure(asAna().report.get.query({ workspaceId, reportId: REPORT.id })),
        ).toMatchObject({ code: 'FORBIDDEN' });
      }
    });

    it('refuses a report id that is not one', async () => {
      expect(
        await failure(asAna().report.get.query({ workspaceId: COMERCIAL, reportId: '1 OR 1=1' })),
      ).toMatchObject({
        code: 'BAD_REQUEST',
        issues: [{ path: 'reportId', code: 'invalid_format' }],
      });
    });
  });

  describe('errors (adjustment 4, P5-7)', () => {
    it.each<[SemanticRuntimeErrorCode, string, number, string]>([
      ['invalid_query', 'BAD_REQUEST', 400, 'filter 1: between takes two values'],
      ['unknown_member', 'NOT_FOUND', 404, 'The query names a member that does not exist.'],
      ['unavailable', 'SERVICE_UNAVAILABLE', 503, 'The semantic layer is unavailable.'],
      ['query_failed', 'INTERNAL_SERVER_ERROR', 500, 'Internal error'],
    ])('answers the semantic error %s as %s', async (code, trpcCode, status, message) => {
      const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      dependencies.semantic.failNextQueryWith = new SemanticRuntimeError(
        code,
        code === 'query_failed' ? 'The query could not be run.' : message,
      );

      expect(
        await failure(asAna().semantic.query.query({ workspaceId: FINANZAS, query: QUERY })),
      ).toEqual({ code: trpcCode, status, message, issues: undefined });
      report.mockRestore();
    });

    it('answers an unexpected failure with "Internal error" — no message, stack or path', async () => {
      const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const cause = new Error('connect ECONNREFUSED 10.89.1.5:5432 password=hunter2');
      dependencies.semantic.failNextQueryWith = cause;

      const response = await post('semantic.query', { workspaceId: FINANZAS, query: QUERY });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: {
          code: -32603,
          message: 'Internal error',
          data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
        },
      });
      expect(report).toHaveBeenCalledWith('api-gateway: semantic.query failed:', cause);
      report.mockRestore();
    });

    it('names the rejected fields and rules of an invalid input, never its values', async () => {
      const response = await failure(
        asAna().semantic.query.query({
          workspaceId: "1' OR '1'='1",
          query: ['not', 'an', 'object'] as never,
        }),
      );

      expect(response).toEqual({
        code: 'BAD_REQUEST',
        status: 400,
        message: 'Invalid input',
        issues: [{ path: 'workspaceId', code: 'invalid_format' }],
      });
      expect(JSON.stringify(response)).not.toContain('OR');
    });

    it('validates the query itself only in the semantic runtime', async () => {
      const response = await failure(
        asAna().semantic.query.query({ workspaceId: FINANZAS, query: 'all of it' as never }),
      );

      expect(response).toMatchObject({
        code: 'BAD_REQUEST',
        issues: [{ path: 'query', code: 'custom' }],
      });
    });
  });

  describe('transport limits (adjustment 4, P5-7)', () => {
    it('refuses GET: an input in a URL ends up in logs and spans', async () => {
      const input = encodeURIComponent(JSON.stringify({ workspaceId: FINANZAS, query: QUERY }));
      for (const url of ['/api/trpc/session.me', `/api/trpc/semantic.query?input=${input}`]) {
        const response = await app.inject({
          method: 'GET',
          url,
          headers: { authorization: `Bearer ${ANA_TOKEN}` },
        });

        expect(response.statusCode).toBe(405);
        expect(response.headers.allow).toBe('POST');
      }
      expect(dependencies.semantic.calls).toEqual([]);
    });

    it(`batches at most ${MAX_BATCH_SIZE} calls`, async () => {
      const batch = (size: number) => {
        const paths = Array.from({ length: size }, () => 'session.me').join(',');
        const input = Object.fromEntries([...Array(size).keys()].map((index) => [index, {}]));
        return post(`${paths}?batch=1`, input);
      };

      const allowed = await batch(MAX_BATCH_SIZE);
      const refused = await batch(MAX_BATCH_SIZE + 1);

      expect(allowed.statusCode).toBe(200);
      expect(refused.statusCode).toBe(400);
      expect(refused.body).not.toMatch(/stack|session\.me/);
    });

    it('refuses a body over 1 MB before parsing it', async () => {
      const response = await post('semantic.query', {
        workspaceId: FINANZAS,
        query: {
          ...QUERY,
          filters: [{ member: 'x', operator: 'in', values: ['x'.repeat(1_100_000)] }],
        },
      });

      expect(response.statusCode).toBe(413);
      expect(dependencies.semantic.calls).toEqual([]);
    });
  });
});

describe('health and readiness', () => {
  it('answers /health while the process serves, /ready only when the database answers', async () => {
    let databaseUp = true;
    const app = await buildTestGateway({
      ...fakeDependencies(),
      ready: () => (databaseUp ? Promise.resolve() : Promise.reject(new Error('ECONNREFUSED'))),
    });
    try {
      expect((await app.inject('/health')).json()).toEqual({ status: 'ok' });
      expect((await app.inject('/ready')).json()).toEqual({ status: 'ready' });

      databaseUp = false;
      const notReady = await app.inject('/ready');

      expect(notReady.statusCode).toBe(503);
      expect(notReady.json()).toEqual({ status: 'not_ready' });
      expect((await app.inject('/health')).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('sends the headers of a JSON API: no CORS, nothing to render or cache', async () => {
    const app = await buildTestGateway(fakeDependencies());
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'http://evil.example' },
      });

      expect(response.headers).toMatchObject({
        'content-security-policy': "default-src 'none';frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      });
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
