import type { DuckDBConnection } from '@duckdb/node-api';

import { openLakehouseInstance } from '../../../src/adapters/duckdb/instance-initializer.ts';
import type { LakehouseSettings } from '../../../src/index.ts';

export {
  CATALOG_TYPES,
  createTestLakehouse,
  developmentAdminUrl,
  installedExtensionDirectory,
  removeFolder,
  testS3Storage,
} from '../../../src/testing/index.ts';
export type { TestLakehouse } from '../../../src/testing/index.ts';

/**
 * A raw connection without the ports' guard or READ_ONLY — for the warehouse's own tests of what
 * the engine and the servers refuse on their own (never exported to other packages).
 */
export async function withLakehouseConnection<T>(
  settings: LakehouseSettings,
  work: (connection: DuckDBConnection) => Promise<T>,
): Promise<T> {
  const instance = await openLakehouseInstance(settings, 'write');
  const connection = await instance.connect();
  try {
    return await work(connection);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}
