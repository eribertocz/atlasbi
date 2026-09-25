import type { AnalyticalQueryPort, LakehouseAdminPort } from '@atlasbi/contracts';

import { DuckDBAnalyticalQueryEngine } from './adapters/duckdb/duckdb-analytical-query-engine.ts';
import { DuckDBLakehouseAdmin } from './adapters/duckdb/duckdb-lakehouse-admin.ts';
import { LakehouseEngine } from './adapters/duckdb/lakehouse-engine.ts';
import type { TelemetryProviders } from './adapters/duckdb/telemetry.ts';
import type { LakehouseSettings } from './lakehouse-settings.ts';

export {
  checkLakehouseExtensions,
  installLakehouseExtensions,
} from './adapters/duckdb/extensions.ts';
export type { ExtensionState, ExtensionStatus } from './adapters/duckdb/extensions.ts';
export { provisionLakehouse } from './adapters/duckdb/provision.ts';
export type { ProvisionResult } from './adapters/duckdb/provision.ts';
export type { TelemetryProviders } from './adapters/duckdb/telemetry.ts';
export { DEVELOPMENT_DATASET, seedDevelopmentDataset } from './development-dataset.ts';
export type { SeedResult } from './development-dataset.ts';
export { INLINING_POLICY, SUPPORTED_CATALOG_FORMAT } from './lakehouse-policies.ts';
export { describeCatalogType } from './lakehouse-settings.ts';
export type { LakehouseCatalog, LakehouseSettings } from './lakehouse-settings.ts';

/** Read-only port over a hardened, READ_ONLY attach (docs/01 §6.7). */
export async function createAnalyticalQueryEngine(
  settings: LakehouseSettings,
  telemetry: TelemetryProviders = {},
): Promise<AnalyticalQueryPort> {
  return new DuckDBAnalyticalQueryEngine(await LakehouseEngine.open(settings, 'read', telemetry));
}

/** Admin/write port; never creates a lakehouse — that is provisionLakehouse's job alone. */
export async function createLakehouseAdmin(
  settings: LakehouseSettings,
  telemetry: TelemetryProviders = {},
): Promise<LakehouseAdminPort> {
  return new DuckDBLakehouseAdmin(await LakehouseEngine.open(settings, 'write', telemetry));
}
