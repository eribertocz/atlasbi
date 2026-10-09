import type { AnalyticalQueryPort, SecurityContext, SemanticRuntimePort } from '@atlasbi/contracts';
import { describeSemanticRuntimePortContract, normalizeDecimal } from '@atlasbi/contracts-testing';
import { createAnalyticalQueryEngine } from '@atlasbi/warehouse';
import { createTestLakehouse, type TestLakehouse } from '@atlasbi/warehouse/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCubeSemanticRuntime } from '../../src/adapters/cube/cube-semantic-runtime.ts';
import { probeSemanticLayer } from '../../src/index.ts';
import { startCubeStack, type CubeStack } from './support/cube-stack.ts';
import { writeMarts } from './support/marts.ts';

const MART = 'lake.marts.mart_sales_orders';

let lakehouse: TestLakehouse | undefined;
let platform: AnalyticalQueryPort | undefined;
let cube: CubeStack | undefined;

beforeAll(async () => {
  lakehouse = await createTestLakehouse('postgres');
  await writeMarts(lakehouse.settings);
  platform = await createAnalyticalQueryEngine(lakehouse.readerSettings);
  cube = await startCubeStack(lakehouse.readerSettings);
  await probeSemanticLayer({ url: cube.restUrl, apiSecret: cube.apiSecret });
});

afterAll(async () => {
  await cube?.stop();
  await platform?.close();
  await lakehouse?.dispose();
});

function runtime(): SemanticRuntimePort {
  if (cube === undefined) {
    throw new Error('The Cube stack did not start');
  }
  return createCubeSemanticRuntime({ url: cube.restUrl, apiSecret: cube.apiSecret });
}

describeSemanticRuntimePortContract('Cube', {
  model: {
    sum: 'sales_orders.total_amount',
    count: 'sales_orders.order_count',
    ratio: 'sales_orders.average_order_value',
    dimension: 'sales_orders.region',
    entitlementKey: 'region',
    parent: 'regions.zone',
    time: 'sales_orders.order_date',
    dateRange: ['2025-01-01', '2025-03-31'],
  },
  openPort: () => Promise.resolve(runtime()),
  // Nothing listens on the discard port: the connection is refused at once.
  openUnavailablePort: () =>
    Promise.resolve(
      createCubeSemanticRuntime({
        url: 'http://127.0.0.1:9',
        apiSecret: 'x'.repeat(64),
        timeoutMs: 5_000,
      }),
    ),
  dispose: () => Promise.resolve(),
});

describe('Cube runtime against the lakehouse it reads', () => {
  const context = (entitlement: SecurityContext['entitlements'][string]): SecurityContext => ({
    userId: '00000000-0000-4000-8000-000000000001',
    organizationId: '00000000-0000-4000-8000-000000000002',
    workspaceId: '00000000-0000-4000-8000-000000000003',
    workspaceRole: 'viewer',
    entitlements: { region: entitlement },
  });

  async function platformRows(statement: string): Promise<(string | number | null)[][]> {
    const result = await (platform as AnalyticalQueryPort).query(statement);
    return result.rows.map((row) => [...row] as (string | number | null)[]);
  }

  it('answers exactly what the platform wrote, region by region', async () => {
    const expected = await platformRows(
      `SELECT region, sum(amount), count(order_id) FROM ${MART} GROUP BY region ORDER BY region`,
    );

    const result = await runtime().query(
      {
        measures: ['sales_orders.total_amount', 'sales_orders.order_count'],
        dimensions: ['sales_orders.region'],
        order: [{ member: 'sales_orders.region', direction: 'asc' }],
      },
      context({ kind: 'all' }),
    );

    expect(result.rows).toEqual(
      expected.map(([region, amount, count]) => [
        region,
        normalizeDecimal(amount as string),
        count,
      ]),
    );
  });

  it('gives a listed grant its rows only, and nothing of the engine besides the data', async () => {
    const [[north]] = (await platformRows(
      `SELECT sum(amount) FROM ${MART} WHERE region = 'North'`,
    )) as [[string]];

    const result = await runtime().query(
      { measures: ['sales_orders.total_amount'], dimensions: ['sales_orders.region'] },
      context({ kind: 'listed', values: ['North'] }),
    );

    expect(result.rows).toEqual([['North', normalizeDecimal(north)]]);
    // Cube's answer echoes the effective query with the row-level filter and its values, the
    // data source and the pre-aggregation tables (P5-6): none of it crosses the adapter.
    expect(Object.keys(result).sort()).toEqual(['columns', 'rowCount', 'rows', 'truncated']);
    expect(JSON.stringify(result)).not.toMatch(
      /pre_aggregations|dataSource|dbType|rlsAccessDenied/,
    );
  });

  it('sends the query token in the Authorization header, never in the URL', async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    const recording = createCubeSemanticRuntime({
      url: (cube as CubeStack).restUrl,
      apiSecret: (cube as CubeStack).apiSecret,
      fetch: (input, init) => {
        seen.push({
          url: input instanceof Request ? input.url : input.toString(),
          authorization: new Headers(init?.headers).get('authorization'),
        });
        return fetch(input, init);
      },
    });

    await recording.query({ measures: ['sales_orders.order_count'] }, context({ kind: 'all' }));

    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const call of seen) {
      expect(call.url).not.toMatch(/eyJ|token|query=/);
      expect(call.authorization).toMatch(/^eyJ/);
    }
  });
});
