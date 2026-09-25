import type { LakehouseAdminPort } from '@atlasbi/contracts';

/**
 * Deterministic development dataset (docs/19 §6): every column is a pure function of the row
 * number, so two runs — or two machines — produce the same rows. Step 2 (SQLMesh) builds its
 * first stg_/mart_ models on top of it until real ingestion (Step 7) replaces it.
 */
export const DEVELOPMENT_DATASET = {
  table: 'lake.fixture.sales_orders',
  rowCount: 20_000,
} as const;

const STATEMENTS = [
  'CREATE SCHEMA IF NOT EXISTS lake.fixture',
  `CREATE OR REPLACE TABLE ${DEVELOPMENT_DATASET.table} AS
   SELECT
     order_number AS order_id,
     DATE '2025-01-01' + CAST(order_number % 365 AS INTEGER) AS order_date,
     1 + (order_number * 7919) % 500 AS customer_id,
     ['North', 'South', 'East', 'West', 'Central'][1 + order_number % 5] AS region,
     ['Hardware', 'Software', 'Services', 'Support'][1 + (order_number // 5) % 4] AS product_category,
     CAST(1 + order_number % 9 AS INTEGER) AS quantity,
     CAST((500 + (order_number * 37) % 9500) / 100 AS DECIMAL(10, 2)) AS unit_price,
     CAST(CAST(1 + order_number % 9 AS INTEGER) * CAST((500 + (order_number * 37) % 9500) / 100 AS DECIMAL(10, 2)) AS DECIMAL(12, 2)) AS amount
   FROM range(1, ${DEVELOPMENT_DATASET.rowCount + 1}) AS numbers(order_number)`,
] as const;

export interface SeedResult {
  table: string;
  rows: string;
  rowsFlushed: string;
}

/**
 * Idempotent: the table is replaced on every run. The rows go straight to Parquet (far above the
 * inlining limit); the final flush follows Inlining v1 so nothing stays pending in the catalog.
 */
export async function seedDevelopmentDataset(admin: LakehouseAdminPort): Promise<SeedResult> {
  let rows = '0';
  for (const statement of STATEMENTS) {
    rows = (await admin.execute(statement)).affectedRows;
  }
  const { rowsFlushed } = await admin.flushInlinedData();
  return { table: DEVELOPMENT_DATASET.table, rows, rowsFlushed };
}
