import { createTestLakehouse, type TestLakehouse } from '@atlasbi/warehouse/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { refreshSemanticLayer, signJobToken, toQueryClaims } from '../../src/index.ts';
import { startCubeStack, type CubeStack } from './support/cube-stack.ts';
import { writeMarts } from './support/marts.ts';

const anaFinanzas = toQueryClaims({
  userId: '44444444-4444-4444-8444-444444444441',
  organizationId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '33333333-3333-4333-8333-333333333332',
  workspaceRole: 'viewer',
  entitlements: { region: { kind: 'listed', values: ['North'] } },
});

let lakehouse: TestLakehouse;
let cube: CubeStack;

beforeAll(async () => {
  lakehouse = await createTestLakehouse('postgres');
  await writeMarts(lakehouse.settings);
  cube = await startCubeStack(lakehouse.readerSettings);
});

afterAll(async () => {
  await cube?.stop();
  await lakehouse?.dispose();
});

async function call(token: string, path: string, body?: unknown): Promise<number> {
  const response = await fetch(`${cube.restUrl}/cubejs-api/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: token, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  await response.text();
  return response.status;
}

describe('pnpm semantic refresh, against the real semantic layer (Plan C)', () => {
  it('rebuilds every precomputed result and waits for it', async () => {
    const summary = await refreshSemanticLayer({ url: cube.restUrl, apiSecret: cube.apiSecret });

    expect(summary).toMatchObject({ status: 'succeeded', exitCode: 0 });
    expect(summary.builds).toContainEqual({
      name: 'sales_orders.amount_by_region_month',
      status: 'built',
    });
  });

  it('keeps row-level security as it was, the precomputed result in use', async () => {
    const answer = await cube.load(
      {
        measures: ['sales_orders.total_amount'],
        dimensions: ['sales_orders.region'],
        timeDimensions: [{ dimension: 'sales_orders.order_date', granularity: 'month' }],
      },
      anaFinanzas,
    );

    expect(new Set(answer.data?.map((row) => row['sales_orders.region']))).toEqual(
      new Set(['North']),
    );
    expect(Object.keys(answer.usedPreAggregations ?? {})).toHaveLength(1);
  });

  it('never lets a query token start a job, nor a job token read anything (decision C3)', async () => {
    const post = {
      action: 'post',
      selector: { contexts: [{ securityContext: {} }], timezones: ['UTC'] },
    };
    const job = signJobToken(cube.apiSecret);

    expect(await call(cube.token(anaFinanzas), 'pre-aggregations/jobs', post)).toBe(403);
    expect(await call(job, 'load', { query: { measures: ['sales_orders.total_amount'] } })).toBe(
      403,
    );
    expect(await call(job, 'meta')).toBe(403);
    const sql = cube.sqlClient(job);
    await expect(
      sql.connect().then(() => sql.query('SELECT MEASURE(total_amount) FROM sales_orders')),
    ).rejects.toThrow(/API scope is missing/);
    await sql.end().catch(() => undefined);
  });
});
