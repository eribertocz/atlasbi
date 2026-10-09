import { getDataContract } from '@atlasbi/contracts';
import {
  createLakehouseAdmin,
  DEVELOPMENT_DATASET,
  seedDevelopmentDataset,
  type LakehouseSettings,
} from '@atlasbi/warehouse';
import { type ContractRowValue, writeContractView } from '@atlasbi/warehouse/testing';

/** GitHub activity of two repositories, as the mart contract promises it. */
export const GITHUB_EVENTS: readonly Record<string, ContractRowValue>[] = [
  ['acme/widgets#1', 'PushEvent', 'acme/widgets', 'ana', '2026-10-01T09:00:00Z'],
  ['acme/widgets#2', 'IssuesEvent', 'acme/widgets', 'bruno', '2026-10-01T10:30:00Z'],
  ['acme/widgets#3', 'PushEvent', 'acme/widgets', 'ana', '2026-10-02T08:15:00Z'],
  ['acme/gadgets#1', 'WatchEvent', 'acme/gadgets', null, '2026-10-01T12:00:00Z'],
  ['acme/gadgets#2', 'PushEvent', 'acme/gadgets', 'carla', '2026-10-03T23:59:59Z'],
].map(([eventId, eventType, repository, actor, createdAt]) => ({
  /* eslint-disable @typescript-eslint/naming-convention -- the contract's column names. */
  event_id: eventId ?? null,
  event_type: eventType ?? null,
  repository: repository ?? null,
  actor: actor ?? null,
  created_at: createdAt ?? null,
  /* eslint-enable @typescript-eslint/naming-convention */
}));

/**
 * The platform writes what Cube reads: every mart this layer consumes, as a view with exactly the
 * columns its data contract promises — generated from the contract, never written by hand, so a
 * Cube member that reads anything else fails these tests. The sales mart reads the development
 * dataset; the GitHub mart, the rows above. Whether transformation publishes those contracts is
 * @atlasbi/transform's test.
 */
export async function writeMarts(writer: LakehouseSettings): Promise<void> {
  const admin = await createLakehouseAdmin(writer);
  try {
    await seedDevelopmentDataset(admin);
    const sales = getDataContract('mart.sales_orders', 1);
    await admin.execute(`CREATE SCHEMA IF NOT EXISTS lake.${sales.table.schema}`);
    await admin.execute(
      `CREATE OR REPLACE VIEW lake.${sales.table.schema}.${sales.table.name} AS
       SELECT ${sales.columns.map((column) => column.name).join(', ')}
       FROM ${DEVELOPMENT_DATASET.table}`,
    );
    await writeContractView(admin, getDataContract('mart.github_repo_events', 1), GITHUB_EVENTS);
  } finally {
    await admin.close();
  }
}

/** Cube's REST API drops a decimal's trailing zeros ("446207.5"); the platform keeps the scale. */
export function withoutTrailingZeros(decimal: string): string {
  return decimal.includes('.') ? decimal.replace(/0+$/, '').replace(/\.$/, '') : decimal;
}
