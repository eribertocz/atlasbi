import {
  createLakehouseAdmin,
  seedDevelopmentDataset,
  type LakehouseSettings,
} from '@atlasbi/warehouse';

/**
 * The platform writes what Cube reads: the development dataset, and `marts.mart_sales_orders` as a
 * view over it — the shape SQLMesh publishes (a view in the mart schema over a physical table), with
 * the mart's columns. The SQLMesh model itself is tested in @atlasbi/transform.
 */
export async function writeSalesMart(writer: LakehouseSettings): Promise<void> {
  const admin = await createLakehouseAdmin(writer);
  try {
    await seedDevelopmentDataset(admin);
    await admin.execute('CREATE SCHEMA IF NOT EXISTS lake.marts');
    await admin.execute(
      `CREATE OR REPLACE VIEW lake.marts.mart_sales_orders AS
       SELECT order_id, order_date, customer_id, region, product_category, quantity, unit_price, amount
       FROM lake.fixture.sales_orders`,
    );
  } finally {
    await admin.close();
  }
}

/** Cube's REST API drops a decimal's trailing zeros ("446207.5"); the platform keeps the scale. */
export function withoutTrailingZeros(decimal: string): string {
  return decimal.includes('.') ? decimal.replace(/0+$/, '').replace(/\.$/, '') : decimal;
}
