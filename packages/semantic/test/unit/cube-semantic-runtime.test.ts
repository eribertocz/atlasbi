import type { SecurityContext, SemanticQuery } from '@atlasbi/contracts';
import { expectSemanticRuntimeError } from '@atlasbi/contracts-testing';
import { describe, expect, it } from 'vitest';

import { createCubeSemanticRuntime } from '../../src/adapters/cube/cube-semantic-runtime.ts';
import { QUERY_TOKEN } from '../../src/index.ts';

const SECRET = 's'.repeat(64);
/** What an error message must never carry (same rule as the port's contract battery). */
const ENGINE_WORDS =
  /cube|duckdb|ducklake|postgres|lakehouse|\bsql\b|select |http|\b\d{1,3}(\.\d{1,3}){3}\b|\bat \S+ \(/i;

// Cube 1.7.45's /v1/meta, trimmed: a hidden cube, and a member that is not public.
const META = {
  cubes: [
    {
      name: 'sales_orders',
      isVisible: true,
      public: true,
      measures: [
        {
          name: 'sales_orders.total_amount',
          title: 'Sales Orders Total Amount',
          type: 'number',
          aggType: 'sum',
          isVisible: true,
          public: true,
        },
        {
          name: 'sales_orders.order_count',
          title: 'Sales Orders Order Count',
          type: 'number',
          aggType: 'count',
          isVisible: true,
          public: true,
        },
      ],
      dimensions: [
        {
          name: 'sales_orders.region',
          title: 'Sales Orders Region',
          type: 'string',
          isVisible: true,
          public: true,
        },
        {
          name: 'sales_orders.order_date',
          title: 'Sales Orders Order Date',
          type: 'time',
          isVisible: true,
          public: true,
        },
        {
          name: 'sales_orders.order_id',
          title: 'Sales Orders Order Id',
          type: 'number',
          isVisible: false,
          public: false,
        },
      ],
    },
    {
      name: 'internal_staging',
      isVisible: false,
      public: false,
      measures: [{ name: 'internal_staging.rows', title: 'Rows', type: 'number' }],
      dimensions: [],
    },
  ],
};

const context = (entitlements: SecurityContext['entitlements']): SecurityContext => ({
  userId: '44444444-4444-4444-8444-444444444444',
  organizationId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '33333333-3333-4333-8333-333333333333',
  workspaceRole: 'admin',
  entitlements,
});
const ALL = context({ region: { kind: 'all' } });

interface Call {
  path: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

type Reply = { status: number; body: unknown } | 'refuse' | 'hang';

/** A Cube that answers /meta with META and /load with the replies given, in turn. */
function fakeCube(loadReplies: Reply[] = [], metaReply: Reply = { status: 200, body: META }) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const call: Call = {
      path: url.pathname,
      method: init?.method ?? 'GET',
      authorization: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const reply = call.path.endsWith('/meta')
      ? metaReply
      : (loadReplies.shift() ?? { status: 500, body: { error: 'no more replies' } });
    if (reply === 'refuse') {
      throw new TypeError('fetch failed', {
        cause: new Error('connect ECONNREFUSED 10.89.1.5:4000'),
      });
    }
    if (reply === 'hang') {
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error);
        });
      });
    }
    return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), {
      status: reply.status,
    });
  };
  const runtime = createCubeSemanticRuntime({
    url: 'http://cube.test:4000/',
    apiSecret: SECRET,
    fetch,
  });
  return { runtime, calls, loads: () => calls.filter((call) => call.path.endsWith('/load')) };
}

function claimsOf(token: string | null): Record<string, unknown> {
  return JSON.parse(Buffer.from(token?.split('.')[1] ?? '', 'base64url').toString()) as Record<
    string,
    unknown
  >;
}

const BY_MONTH: SemanticQuery = {
  measures: ['sales_orders.total_amount'],
  dimensions: ['sales_orders.region'],
  timeDimensions: [{ member: 'sales_orders.order_date', granularity: 'month' }],
  limit: 2,
};

describe('createCubeSemanticRuntime', () => {
  it('describes what the context may use, without hidden cubes or members that are not public', async () => {
    const { runtime } = fakeCube();

    expect(await runtime.describe(ALL)).toEqual({
      measures: [
        { name: 'sales_orders.total_amount', title: 'Sales Orders Total Amount', type: 'number' },
        { name: 'sales_orders.order_count', title: 'Sales Orders Order Count', type: 'number' },
      ],
      dimensions: [
        { name: 'sales_orders.region', title: 'Sales Orders Region', type: 'string' },
        { name: 'sales_orders.order_date', title: 'Sales Orders Order Date', type: 'time' },
      ],
    });
  });

  it("signs a short query token from the platform's security context — groups, never the role", async () => {
    const { runtime, calls } = fakeCube([{ status: 200, body: { data: [] } }]);

    await runtime.query(
      { measures: ['sales_orders.total_amount'] },
      context({ region: { kind: 'listed', values: ['North'] } }),
    );

    expect(calls.map((call) => [call.method, call.path])).toEqual([
      ['GET', '/cubejs-api/v1/meta'],
      ['POST', '/cubejs-api/v1/load'],
    ]);
    for (const call of calls) {
      const claims = claimsOf(call.authorization);
      expect(claims).toMatchObject({
        iss: QUERY_TOKEN.issuer,
        aud: QUERY_TOKEN.audience,
        groups: ['region:listed'],
        entitlements: { region: ['North'] },
      });
      expect(claims).not.toHaveProperty('workspaceRole');
      expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(300);
    }
  });

  it('waits through "Continue wait", then returns positional rows and whether there were more', async () => {
    const { runtime, loads } = fakeCube([
      { status: 200, body: { error: 'Continue wait' } },
      { status: 200, body: { error: 'Continue wait' } },
      {
        status: 200,
        body: {
          query: {
            filters: [{ member: 'sales_orders.region', operator: 'equals', values: ['North'] }],
          },
          dataSource: 'default',
          usedPreAggregations: { 'prod_pre_aggregations.sales_orders_amount_by_region_month': {} },
          data: [
            {
              'sales_orders.region': 'North',
              'sales_orders.order_date.month': '2025-01-01T00:00:00.000',
              'sales_orders.order_date': '2025-01-01T00:00:00.000',
              'sales_orders.total_amount': '87333.1',
            },
            {
              'sales_orders.region': 'North',
              'sales_orders.order_date.month': '2025-02-01T00:00:00.000',
              'sales_orders.order_date': '2025-02-01T00:00:00.000',
              'sales_orders.total_amount': null,
            },
            {
              'sales_orders.region': 'North',
              'sales_orders.order_date.month': '2025-03-01T00:00:00.000',
              'sales_orders.order_date': '2025-03-01T00:00:00.000',
              'sales_orders.total_amount': '1',
            },
          ],
        },
      },
    ]);

    const result = await runtime.query(BY_MONTH, ALL);

    expect(loads()).toHaveLength(3);
    expect(loads()[0]?.body).toMatchObject({ query: { limit: 3, timezone: 'UTC' } });
    expect(result).toEqual({
      columns: [
        { member: 'sales_orders.region', kind: 'dimension', type: 'string' },
        { member: 'sales_orders.order_date', kind: 'time', type: 'time', granularity: 'month' },
        { member: 'sales_orders.total_amount', kind: 'measure', type: 'number' },
      ],
      rows: [
        ['North', '2025-01-01T00:00:00.000', '87333.1'],
        ['North', '2025-02-01T00:00:00.000', null],
      ],
      rowCount: 2,
      truncated: true,
    });
  });

  it('checks a query before asking for anything, and against the model before asking for data', async () => {
    const malformed = fakeCube();
    await expectSemanticRuntimeError(
      malformed.runtime.query({ measures: ['DROP TABLE x'] }, ALL),
      'invalid_query',
    );
    expect(malformed.calls).toEqual([]);

    const hidden = fakeCube();
    await expectSemanticRuntimeError(
      hidden.runtime.query({ measures: [], dimensions: ['sales_orders.order_id'] }, ALL),
      'unknown_member',
    );
    expect(hidden.loads()).toEqual([]);
  });

  it.each([
    // Cube's own answers, captured in build step 5, Phase 0 (P5-6).
    [
      500,
      {
        error:
          "Error: You requested hidden member: 'sales_orders.total_amount'. Please make it visible using `public: true`.",
      },
      'unknown_member',
      false,
    ],
    [
      400,
      { type: 'UserError', error: "'nope' not found for path 'sales_orders.nope'" },
      'unknown_member',
      false,
    ],
    [
      400,
      { error: 'Invalid query format: "filters[0]" does not match any of the allowed types' },
      'invalid_query',
      false,
    ],
    [
      400,
      {
        error:
          "Error: Internal: Execution error: Internal: Arrow error: Parser error: Error parsing timestamp from 'Invalid date'",
      },
      'invalid_query',
      false,
    ],
    [500, { error: 'Error: The query limit has been exceeded.' }, 'invalid_query', false],
    [500, { error: 'TypeError: array?.some is not a function' }, 'query_failed', false],
    [
      500,
      { error: 'Error: The query token has expired, or it is not short-lived' },
      'unavailable',
      true,
    ],
    [
      500,
      {
        error:
          'Error: The lakehouse is unavailable to the semantic layer; the details are in the Cube logs.',
      },
      'unavailable',
      true,
    ],
    [403, { error: 'Invalid token' }, 'unavailable', false],
    [503, '<html>Service Unavailable</html>', 'unavailable', true],
  ] as const)(
    'turns Cube HTTP %i %j into %s, without its words',
    async (status, body, code, retryable) => {
      const { runtime } = fakeCube([{ status, body }]);

      const error = await expectSemanticRuntimeError(
        runtime.query({ measures: ['sales_orders.total_amount'] }, ALL),
        code,
      );

      expect(error.retryable).toBe(retryable);
      expect(error.message).not.toMatch(ENGINE_WORDS);
      expect(error.message).not.toMatch(/sales_orders|public: true|Arrow|TypeError/);
    },
  );

  it('reports a refused connection as unavailable, without the address', async () => {
    const { runtime } = fakeCube([], 'refuse');

    const error = await expectSemanticRuntimeError(runtime.describe(ALL), 'unavailable');

    expect(error.retryable).toBe(true);
    expect(error.message).not.toMatch(ENGINE_WORDS);
  });

  it('gives up at the deadline — a hanging answer and an endless "Continue wait" alike', async () => {
    const hanging = fakeCube(['hang']);
    const waiting = fakeCube(
      Array.from({ length: 10_000 }, () => ({ status: 200, body: { error: 'Continue wait' } })),
    );
    const started = Date.now();

    for (const { runtime } of [hanging, waiting]) {
      const error = await expectSemanticRuntimeError(
        runtime.query({ measures: ['sales_orders.total_amount'] }, ALL, { timeoutMs: 100 }),
        'unavailable',
      );
      expect(error.retryable).toBe(true);
    }
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('declares its capabilities', () => {
    expect(fakeCube().runtime.capabilities).toEqual({
      windowFunctions: false,
      multiStageCalculations: true,
      preAggregations: true,
      semanticSql: false,
    });
  });
});
