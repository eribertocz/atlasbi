import type { AnalyticalQueryPort, SecurityContext } from '@atlasbi/contracts';
import { createAnalyticalQueryEngine } from '@atlasbi/warehouse';
import { createTestLakehouse, type TestLakehouse } from '@atlasbi/warehouse/testing';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { READINESS_CLAIMS, toQueryClaims } from '../../src/index.ts';
import { ALL_REGIONS, forgeToken, startCubeStack, type CubeStack } from './support/cube-stack.ts';
import { withoutTrailingZeros, writeSalesMart } from './support/sales-mart.ts';

const MART = 'lake.marts.mart_sales_orders';
const ORG = '11111111-1111-4111-8111-111111111111';
const COMERCIAL = '33333333-3333-4333-8333-333333333331';
const FINANZAS = '33333333-3333-4333-8333-333333333332';
const ANA = '44444444-4444-4444-8444-444444444441';
const BRUNO = '44444444-4444-4444-8444-444444444442';

// The scenario of the MVP acceptance script (docs/16 §4), as the security contexts that
// @atlasbi/auth resolves for it: Ana is admin in Comercial with every region, and viewer in
// Finanzas with North; Bruno is viewer in Finanzas with South.
const anaComercial: SecurityContext = {
  userId: ANA,
  organizationId: ORG,
  workspaceId: COMERCIAL,
  workspaceRole: 'admin',
  entitlements: { region: { kind: 'all' } },
};
const anaFinanzas: SecurityContext = {
  userId: ANA,
  organizationId: ORG,
  workspaceId: FINANZAS,
  workspaceRole: 'viewer',
  entitlements: { region: { kind: 'listed', values: ['North'] } },
};
const brunoFinanzas: SecurityContext = {
  userId: BRUNO,
  organizationId: ORG,
  workspaceId: FINANZAS,
  workspaceRole: 'viewer',
  entitlements: { region: { kind: 'listed', values: ['South'] } },
};
const noGrant: SecurityContext = { ...brunoFinanzas, entitlements: {} };

const BY_REGION = {
  measures: ['sales_orders.total_amount'],
  dimensions: ['sales_orders.region'],
  order: { 'sales_orders.region': 'asc' },
};

let lakehouse: TestLakehouse | undefined;
let platform: AnalyticalQueryPort | undefined;
let cube: CubeStack;
/** Per region, as the platform's own read port sums it: the numbers every slice must match. */
const expected = new Map<string, string>();
const slice = (region: string) => ({ [region]: expected.get(region) });

beforeAll(async () => {
  lakehouse = await createTestLakehouse('postgres');
  await writeSalesMart(lakehouse.settings);
  platform = await createAnalyticalQueryEngine(lakehouse.readerSettings);
  const rows = await platform.query(`SELECT region, sum(amount) FROM ${MART} GROUP BY region`);
  // VARCHAR and DECIMAL both come back as strings from the read port (docs/01 §7).
  for (const row of rows.rows) {
    const [region, amount] = row as unknown as [string, string];
    expected.set(region, withoutTrailingZeros(amount));
  }
  cube = await startCubeStack(lakehouse.readerSettings);
});

afterAll(async () => {
  await cube?.stop();
  await platform?.close();
  await lakehouse?.dispose();
});

async function regions(context: SecurityContext | object): Promise<Record<string, string>> {
  const claims = 'workspaceRole' in context ? toQueryClaims(context) : context;
  const response = await cube.load(BY_REGION, claims);
  if (response.error !== undefined || response.data === undefined) {
    throw new Error(`denied: ${response.error ?? 'no data'}`);
  }
  return Object.fromEntries(
    response.data.map((row) => [row['sales_orders.region'], row['sales_orders.total_amount']]),
  ) as Record<string, string>;
}

describe('row-level security over REST (build step 4)', () => {
  it('shows Ana every region in Comercial, with the platform numbers', async () => {
    await expect(regions(anaComercial)).resolves.toEqual(Object.fromEntries(expected));
  });

  it('shows two viewers of Finanzas different slices of the same metric', async () => {
    await expect(regions(anaFinanzas)).resolves.toEqual(slice('North'));
    await expect(regions(brunoFinanzas)).resolves.toEqual(slice('South'));
  });

  it('applies the slice to totals, to the pre-aggregation and through the join to regions', async () => {
    const claims = toQueryClaims(anaFinanzas);
    const total = await cube.load({ measures: ['sales_orders.total_amount'] }, claims);
    const monthly = await cube.load(
      {
        measures: ['sales_orders.total_amount'],
        dimensions: ['sales_orders.region'],
        timeDimensions: [{ dimension: 'sales_orders.order_date', granularity: 'month' }],
      },
      claims,
    );
    const zones = await cube.load(
      { measures: ['sales_orders.total_amount'], dimensions: ['regions.zone'] },
      claims,
    );
    const listed = await cube.load({ dimensions: ['regions.region'] }, claims);

    expect(total.data).toEqual([{ 'sales_orders.total_amount': expected.get('North') }]);
    expect(new Set(monthly.data?.map((row) => row['sales_orders.region']))).toEqual(
      new Set(['North']),
    );
    expect(Object.keys(monthly.usedPreAggregations ?? {})).toEqual([
      expect.stringContaining('amount_by_region_month'),
    ]);
    expect(zones.data).toEqual([
      { 'regions.zone': 'Axis', 'sales_orders.total_amount': expected.get('North') },
    ]);
    expect(listed.data).toEqual([{ 'regions.region': 'North' }]);
  });

  it('denies someone without a grant — no rows, an error', async () => {
    await expect(regions(noGrant)).rejects.toThrow(/denied/);
  });

  it('lets the readiness probe read regions.zone and nothing else', async () => {
    const zone = await cube.load({ dimensions: ['regions.zone'], limit: 1 }, READINESS_CLAIMS);
    const amount = await cube.load({ measures: ['sales_orders.total_amount'] }, READINESS_CLAIMS);
    const region = await cube.load({ dimensions: ['regions.region'] }, READINESS_CLAIMS);

    expect(zone.data).toHaveLength(1);
    expect(amount.error).toBeDefined();
    expect(region.error).toBeDefined();
  });

  it('refuses tokens the platform never signs: no expiry, too long, another algorithm or audience', async () => {
    const now = Math.floor(Date.now() / 1000);
    const forged = [
      forgeToken(cube.apiSecret, { ...ALL_REGIONS, exp: undefined }),
      forgeToken(cube.apiSecret, { ...ALL_REGIONS, exp: now + 3600 }),
      forgeToken(cube.apiSecret, { ...ALL_REGIONS, exp: now - 5 }),
      forgeToken(cube.apiSecret, ALL_REGIONS, 'HS512'),
      forgeToken(cube.apiSecret, { ...ALL_REGIONS, aud: 'platform-api' }),
      forgeToken('another-secret', ALL_REGIONS),
    ];

    for (const token of forged) {
      const response = await cube.load(BY_REGION, token);
      expect(response.data, token).toBeUndefined();
      expect(response.error, token).toBeDefined();
    }
  });
});

describe('row-level security over the SQL API (decision E5)', () => {
  const SQL =
    'SELECT region, MEASURE(total_amount) AS amount FROM sales_orders GROUP BY 1 ORDER BY 1';

  async function sqlRegions(password: string): Promise<string[]> {
    const client = cube.sqlClient(password);
    await client.connect();
    try {
      return (await client.query<{ region: string }>(SQL)).rows.map((row) => row.region);
    } finally {
      await client.end();
    }
  }

  it('applies the same slices as REST, with the query token as the password', async () => {
    await expect(sqlRegions(cube.token(toQueryClaims(anaComercial)))).resolves.toEqual(
      [...expected.keys()].sort(),
    );
    await expect(sqlRegions(cube.token(toQueryClaims(anaFinanzas)))).resolves.toEqual(['North']);
    await expect(sqlRegions(cube.token(toQueryClaims(brunoFinanzas)))).resolves.toEqual(['South']);
    await expect(sqlRegions(cube.token(toQueryClaims(noGrant)))).rejects.toThrow(/not found/);
  });

  it('refuses a connection with a token that is expired, too long-lived or forged', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const password of [
      forgeToken(cube.apiSecret, { ...ALL_REGIONS, exp: now - 5 }),
      forgeToken(cube.apiSecret, { ...ALL_REGIONS, exp: now + 3600 }),
      forgeToken('another-secret', ALL_REGIONS),
    ]) {
      await expect(sqlRegions(password)).rejects.toThrow(/password authentication failed/);
    }
  });

  it('never lets an open connection outlive the token that opened it', async () => {
    const client = cube.sqlClient(cube.token(ALL_REGIONS, 3));
    await client.connect();
    try {
      await expect(client.query(SQL)).resolves.toMatchObject({ rowCount: expected.size });
      await delay(4_000);

      await expect(client.query(SQL)).rejects.toThrow(/query token has expired/);
    } finally {
      await client.end();
    }
  });
});
