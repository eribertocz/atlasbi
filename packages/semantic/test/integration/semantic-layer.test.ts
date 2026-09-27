import type { AnalyticalQueryPort, QueryResult } from '@atlasbi/contracts';
import { createAnalyticalQueryEngine } from '@atlasbi/warehouse';
import { createTestLakehouse, type TestLakehouse } from '@atlasbi/warehouse/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { probeSemanticLayer } from '../../src/index.ts';
import { ALL_REGIONS, startCubeStack, type CubeStack } from './support/cube-stack.ts';
import { withoutTrailingZeros, writeSalesMart } from './support/sales-mart.ts';

const MART = 'lake.marts.mart_sales_orders';
const FIRST_HALF = ['2025-01-01', '2025-06-30'];

let lakehouse: TestLakehouse | undefined;
let platform: AnalyticalQueryPort | undefined;
let cube: CubeStack;

beforeAll(async () => {
  lakehouse = await createTestLakehouse('postgres');
  await writeSalesMart(lakehouse.settings);
  platform = await createAnalyticalQueryEngine(lakehouse.readerSettings);
  cube = await startCubeStack(lakehouse.readerSettings);
  await probeSemanticLayer({ url: cube.restUrl, apiSecret: cube.apiSecret });
});

afterAll(async () => {
  await cube?.stop();
  await platform?.close();
  await lakehouse?.dispose();
});

/** The platform's own answer, through its read port, as the same reader Cube uses. */
async function platformRows(statement: string): Promise<(string | number | null)[][]> {
  const result: QueryResult = await (platform as AnalyticalQueryPort).query(statement);
  return result.rows.map((row) => [...row] as (string | number | null)[]);
}

async function cubeRows(query: unknown): Promise<Record<string, string | null>[]> {
  const response = await cube.load(query);
  if (response.error !== undefined || response.data === undefined) {
    throw new Error(`Cube answered HTTP ${response.status}: ${response.error ?? 'no data'}`);
  }
  return response.data;
}

function decimal(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : withoutTrailingZeros(value);
}

describe('Cube over the lakehouse, as its reader (REST)', () => {
  it('answers exactly what the platform wrote', async () => {
    const expected = await platformRows(
      `SELECT count(order_id), sum(amount), count(DISTINCT customer_id) FROM ${MART}`,
    );
    const byRegion = await platformRows(
      `SELECT region, sum(amount), count(order_id) FROM ${MART} GROUP BY region ORDER BY region`,
    );

    const [totals] = await cubeRows({
      measures: [
        'sales_orders.order_count',
        'sales_orders.total_amount',
        'sales_orders.distinct_customers',
      ],
    });
    const regions = await cubeRows({
      measures: ['sales_orders.total_amount', 'sales_orders.order_count'],
      dimensions: ['sales_orders.region'],
      order: { 'sales_orders.region': 'asc' },
    });

    expect(totals).toEqual({
      'sales_orders.order_count': expected[0]?.[0],
      'sales_orders.total_amount': decimal(expected[0]?.[1] as string),
      'sales_orders.distinct_customers': expected[0]?.[2],
    });
    expect(
      regions.map((row) => [
        row['sales_orders.region'],
        row['sales_orders.total_amount'],
        row['sales_orders.order_count'],
      ]),
    ).toEqual(
      byRegion.map(([region, amount, count]) => [region, decimal(amount as string), count]),
    );
  });

  it('computes time intelligence — prior month, month over month, rolling 3 months — like SQL windows do', async () => {
    const expected = await platformRows(
      `WITH monthly AS (
         SELECT date_trunc('month', order_date) AS month, sum(amount) AS amount FROM ${MART} GROUP BY 1
       )
       SELECT strftime(month, '%Y-%m'), amount, lag(amount) OVER (ORDER BY month),
              sum(amount) OVER (ORDER BY month ROWS 2 PRECEDING)
       FROM monthly ORDER BY month LIMIT 6`,
    );

    const months = await cubeRows({
      measures: [
        'sales_orders.total_amount',
        'sales_orders.total_amount_prior_month',
        'sales_orders.amount_growth_mom',
        'sales_orders.rolling_amount_3m',
      ],
      timeDimensions: [
        { dimension: 'sales_orders.order_date', granularity: 'month', dateRange: FIRST_HALF },
      ],
      order: { 'sales_orders.order_date': 'asc' },
    });

    expect(months).toHaveLength(6);
    months.forEach((row, index) => {
      const [month, amount, prior, rolling] = expected[index] ?? [];
      expect(row['sales_orders.order_date.month']?.slice(0, 7)).toBe(month);
      expect(row['sales_orders.total_amount']).toBe(decimal(amount as string));
      expect(row['sales_orders.total_amount_prior_month']).toBe(decimal(prior as string | null));
      expect(row['sales_orders.rolling_amount_3m']).toBe(decimal(rolling as string));
      if (prior === null) {
        expect(row['sales_orders.amount_growth_mom']).toBeNull();
      } else {
        expect(Number(row['sales_orders.amount_growth_mom'])).toBeCloseTo(
          (Number(amount) - Number(prior)) / Number(prior),
          12,
        );
      }
    });
  });

  it('joins sales to regions derived from the mart itself', async () => {
    const expected = await platformRows(
      `SELECT CASE WHEN region IN ('North', 'South') THEN 'Axis' ELSE 'Other' END AS zone, sum(amount)
       FROM ${MART} GROUP BY 1 ORDER BY 1`,
    );

    const zones = await cubeRows({
      measures: ['sales_orders.total_amount'],
      dimensions: ['regions.zone'],
      order: { 'regions.zone': 'asc' },
    });

    expect(zones.map((row) => [row['regions.zone'], row['sales_orders.total_amount']])).toEqual(
      expected.map(([zone, amount]) => [zone, decimal(amount as string)]),
    );
  });

  it('answers from its pre-aggregation in Cube Store, and never writes to the lakehouse', async () => {
    const files = await lakehouse?.listDataFiles();

    const response = await cube.load({
      measures: ['sales_orders.total_amount'],
      dimensions: ['sales_orders.region'],
      timeDimensions: [{ dimension: 'sales_orders.order_date', granularity: 'month' }],
    });

    expect(response.error).toBeUndefined();
    expect(Object.keys(response.usedPreAggregations ?? {})).toEqual([
      expect.stringContaining('sales_orders_amount_by_region_month'),
    ]);
    // The pre-aggregation lives in Cube Store: the lakehouse keeps exactly its own files.
    await expect(lakehouse?.listDataFiles()).resolves.toEqual(files);
  });

  it('keeps DuckDB offline: no DuckDB home in the container, no extension downloaded', async () => {
    await expect(cube.exec(['test', '-e', '/root/.duckdb'])).resolves.toBe(1);
  });

  it('has no route to the Internet from its network', async () => {
    const tryInternet =
      "fetch('https://registry.npmjs.org', { signal: AbortSignal.timeout(5000) })" +
      '.then(() => process.exit(0), () => process.exit(3))';

    await expect(cube.exec(['node', '-e', tryInternet])).resolves.toBe(3);
  });
});

describe("Cube's SQL API (PostgreSQL wire protocol)", () => {
  let client: pg.Client;

  beforeAll(async () => {
    // No fixed password: the SQL API takes a query token (build step 4, decision E5).
    client = cube.sqlClient(cube.token(ALL_REGIONS));
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  it('refuses a plain password: only a query token opens it', async () => {
    const intruder = cube.sqlClient('not-a-query-token');

    await expect(intruder.connect()).rejects.toThrow(/password authentication failed/);
    await intruder.end().catch(() => undefined);
  });

  it('answers with the platform numbers — as floats, not decimals', async () => {
    const expected = await platformRows(
      `SELECT CASE WHEN region IN ('North', 'South') THEN 'Axis' ELSE 'Other' END AS zone, sum(amount)
       FROM ${MART} GROUP BY 1 ORDER BY 1`,
    );

    const result = await client.query<{ zone: string; amount: number }>(
      'SELECT regions.zone, MEASURE(sales_orders.total_amount) AS amount FROM sales_orders CROSS JOIN regions GROUP BY 1 ORDER BY 1',
    );

    expect(result.rows.map((row) => row.zone)).toEqual(expected.map(([zone]) => zone));
    result.rows.forEach((row, index) => {
      expect(typeof row.amount).toBe('number');
      expect(row.amount).toBeCloseTo(Number(expected[index]?.[1]), 2);
    });
  });

  // docs/17 §3.2.2: where each pattern runs. "Cube query": one Cube query, aggregated in DuckDB.
  // "DuckDB SQL": the whole statement, windows included, pushed to DuckDB. Cube itself only ever
  // projects or filters the aggregated rows of either.
  const battery = [
    {
      pattern: 'simple measure',
      sql: 'SELECT region, MEASURE(total_amount) FROM sales_orders GROUP BY 1',
      runs: 'Cube query',
      inCube: [],
    },
    {
      pattern: 'ratio of measures',
      sql: 'SELECT region, MEASURE(total_amount) / MEASURE(order_count) AS ratio FROM sales_orders GROUP BY 1',
      runs: 'Cube query',
      inCube: ['ProjectionExec'],
    },
    {
      pattern: 'ratio of measures, ordered',
      sql: 'SELECT region, MEASURE(total_amount) / MEASURE(order_count) AS ratio FROM sales_orders GROUP BY 1 ORDER BY 2 DESC',
      runs: 'DuckDB SQL',
      inCube: [],
    },
    {
      pattern: 'window function (RANK, cast)',
      sql: 'SELECT region, MEASURE(total_amount) AS amount, CAST(RANK() OVER (ORDER BY MEASURE(total_amount) DESC) AS INTEGER) AS position FROM sales_orders GROUP BY 1',
      runs: 'DuckDB SQL',
      inCube: [],
    },
    {
      pattern: 'filter on a measure (HAVING)',
      sql: 'SELECT region, MEASURE(total_amount) FROM sales_orders GROUP BY 1 HAVING MEASURE(total_amount) > 1000',
      runs: 'Cube query',
      inCube: [],
    },
    {
      pattern: 'CTE',
      sql: 'WITH by_region AS (SELECT region, MEASURE(total_amount) AS amount FROM sales_orders GROUP BY 1) SELECT * FROM by_region',
      runs: 'Cube query',
      inCube: [],
    },
    {
      pattern: 'CTEs joined, filtered',
      sql: 'WITH a AS (SELECT region, MEASURE(total_amount) AS amount FROM sales_orders GROUP BY 1), b AS (SELECT region, MEASURE(order_count) AS orders FROM sales_orders GROUP BY 1) SELECT a.region, a.amount, b.orders FROM a JOIN b ON a.region = b.region WHERE a.amount > 1000',
      runs: 'DuckDB SQL',
      inCube: ['ProjectionExec', 'FilterExec'],
    },
    {
      pattern: 'join between cubes',
      sql: 'SELECT regions.zone, MEASURE(sales_orders.total_amount) FROM sales_orders CROSS JOIN regions GROUP BY 1',
      runs: 'Cube query',
      inCube: [],
    },
    {
      pattern: 'rolling window (model)',
      sql: "SELECT DATE_TRUNC('month', order_date) AS month, MEASURE(rolling_amount_3m) FROM sales_orders WHERE order_date >= '2025-01-01' AND order_date < '2025-07-01' GROUP BY 1",
      runs: 'Cube query',
      inCube: [],
    },
    {
      pattern: 'rolling window (SQL)',
      sql: "SELECT month, SUM(amount) OVER (ORDER BY month ROWS 2 PRECEDING) FROM (SELECT DATE_TRUNC('month', order_date) AS month, MEASURE(total_amount) AS amount FROM sales_orders GROUP BY 1) AS monthly",
      runs: 'DuckDB SQL',
      inCube: [],
    },
    {
      pattern: 'time shift (model)',
      sql: "SELECT DATE_TRUNC('month', order_date) AS month, MEASURE(total_amount_prior_month) FROM sales_orders WHERE order_date >= '2025-01-01' AND order_date < '2025-07-01' GROUP BY 1",
      runs: 'Cube query',
      inCube: [],
    },
    {
      pattern: 'time shift (SQL LAG)',
      sql: "SELECT month, LAG(amount) OVER (ORDER BY month) FROM (SELECT DATE_TRUNC('month', order_date) AS month, MEASURE(total_amount) AS amount FROM sales_orders GROUP BY 1) AS monthly",
      runs: 'DuckDB SQL',
      inCube: [],
    },
  ] as const;

  it.each(battery)('pushes down: $pattern → $runs', async ({ sql, runs, inCube }) => {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Cube's EXPLAIN columns.
    const plan = await client.query<{ plan_type: string; plan: string }>(`EXPLAIN ${sql}`);
    const physical = plan.rows.find((row) => row.plan_type === 'physical_plan')?.plan ?? '';

    expect(physical).toContain(
      runs === 'Cube query' ? 'CubeScanExecutionPlan, Request:' : 'CubeScanExecutionPlan, SQL:',
    );
    const cubeOperators = physical
      .slice(0, physical.indexOf('CubeScanExecutionPlan'))
      .match(/\b(ProjectionExec|FilterExec|SortExec|AggregateExec|WindowAggExec)\b/g);
    expect(cubeOperators ?? []).toEqual(inCube);
    expect((await client.query(sql)).rowCount).toBeGreaterThan(0);
  });

  // Alert tests (docs/17 §3.2.2): each asserts a gap of Cube 1.7.45 as it is today. When one
  // starts failing, the gap is gone — update docs/17 §3.2.2 and the Visual Builder's workaround.
  describe('known gaps of Cube 1.7.45', () => {
    it('RANK() without a CAST fails: its UInt64 result is not transformed', async () => {
      await expect(
        client.query(
          'SELECT region, RANK() OVER (ORDER BY MEASURE(total_amount) DESC) AS position FROM sales_orders GROUP BY 1',
        ),
      ).rejects.toThrow(/Type UInt64 is not supported in response transformation/);
    });

    it('a filter on a decimal measure, ordered, fails when a pre-aggregation serves it — REST and SQL alike', async () => {
      const decimalGap = /Invalid comparison operation: Decimal128\(38, 2\) > Decimal128\(37, 2\)/;
      const query = (dimension: string) => ({
        measures: ['sales_orders.total_amount'],
        dimensions: [dimension],
        filters: [{ member: 'sales_orders.total_amount', operator: 'gt', values: ['1000'] }],
        order: { 'sales_orders.total_amount': 'desc' },
      });

      // Region is in amount_by_region_month: Cube Store answers, and fails.
      const fromCubeStore = await cube.load(query('sales_orders.region'));
      // Product category is not: DuckDB answers the very same shape.
      const fromDuckDB = await cube.load(query('sales_orders.product_category'));

      expect(fromCubeStore.error).toMatch(decimalGap);
      expect(fromDuckDB.error).toBeUndefined();
      expect(fromDuckDB.data).toHaveLength(4);
      await expect(
        client.query(
          'SELECT region, MEASURE(total_amount) FROM sales_orders GROUP BY 1 HAVING MEASURE(total_amount) > 1000 ORDER BY 2 DESC',
        ),
      ).rejects.toThrow(decimalGap);
      // An integer measure takes the same path without failing.
      const counts = await cube.load({
        ...query('sales_orders.region'),
        measures: ['sales_orders.order_count'],
        filters: [{ member: 'sales_orders.order_count', operator: 'gt', values: ['1000'] }],
        order: { 'sales_orders.order_count': 'desc' },
      });
      expect(counts.error).toBeUndefined();
    });
  });
});
