import { SECRET_KEYS, type LakehouseConfig } from '@atlasbi/config';
import type { SecretProvider } from '@atlasbi/contracts';
import type { LakehouseSettings } from '@atlasbi/warehouse';

/** Config + secrets → what the warehouse needs to open the lakehouse. */
export async function resolveLakehouseSettings(
  lakehouse: LakehouseConfig,
  secrets: SecretProvider,
): Promise<LakehouseSettings> {
  return {
    catalog:
      lakehouse.catalogType === 'postgres'
        ? {
            type: 'postgres',
            connectionString: await secrets.get(SECRET_KEYS.lakehouseCatalogUrl),
          }
        : { type: 'sqlite', path: lakehouse.sqliteCatalogPath },
    dataPath: lakehouse.dataPath,
    extensionDirectory: lakehouse.extensionDirectory,
  };
}

/** A lakehouse failure as one line: what happened, then what to do about it. */
export function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const remedy = (error as { remedy?: unknown } | undefined)?.remedy;
  return typeof remedy === 'string' ? `${message} → ${remedy}` : message;
}
