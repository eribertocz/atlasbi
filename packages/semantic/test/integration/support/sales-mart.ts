import { getDataContract } from '@atlasbi/contracts';
import {
  createLakehouseAdmin,
  DEVELOPMENT_DATASET,
  seedDevelopmentDataset,
  type LakehouseSettings,
} from '@atlasbi/warehouse';

import { CONSUMED_DATA_CONTRACTS } from '../../../src/index.ts';

/**
 * The platform writes what Cube reads: the development dataset, and the mart as a view over it with
 * exactly the columns its data contract promises — generated from the contract, never written by
 * hand, so a Cube member that reads anything else fails these tests. Whether transformation
 * publishes that contract is @atlasbi/transform's test.
 */
export async function writeSalesMart(writer: LakehouseSettings): Promise<void> {
  const admin = await createLakehouseAdmin(writer);
  try {
    await seedDevelopmentDataset(admin);
    for (const { id, major } of CONSUMED_DATA_CONTRACTS) {
      const { table, columns } = getDataContract(id, major);
      await admin.execute(`CREATE SCHEMA IF NOT EXISTS lake.${table.schema}`);
      await admin.execute(
        `CREATE OR REPLACE VIEW lake.${table.schema}.${table.name} AS
         SELECT ${columns.map((column) => column.name).join(', ')}
         FROM ${DEVELOPMENT_DATASET.table}`,
      );
    }
  } finally {
    await admin.close();
  }
}

/** Cube's REST API drops a decimal's trailing zeros ("446207.5"); the platform keeps the scale. */
export function withoutTrailingZeros(decimal: string): string {
  return decimal.includes('.') ? decimal.replace(/0+$/, '').replace(/\.$/, '') : decimal;
}
