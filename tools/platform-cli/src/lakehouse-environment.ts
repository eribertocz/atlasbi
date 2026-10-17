import { SECRET_KEYS, type LakehouseConfig } from '@atlasbi/config';
import type { SecretProvider } from '@atlasbi/contracts';
import type { LakehouseSettings, LakehouseStorage } from '@atlasbi/warehouse';

/** Who opens the lakehouse: the writer (admin port, seed, transform) or a reader (query port). */
export type LakehouseAccessIdentity = 'writer' | 'reader';

/** Config + secrets → what the warehouse needs to open the lakehouse, as the given identity. */
export async function resolveLakehouseSettings(
  lakehouse: LakehouseConfig,
  secrets: SecretProvider,
  identity: LakehouseAccessIdentity = 'writer',
): Promise<LakehouseSettings> {
  const reader = identity === 'reader';
  return {
    catalog:
      lakehouse.catalogType === 'postgres'
        ? {
            type: 'postgres',
            connectionString: await secrets.get(
              reader ? SECRET_KEYS.lakehouseCatalogReaderUrl : SECRET_KEYS.lakehouseCatalogUrl,
            ),
          }
        : { type: 'sqlite', path: lakehouse.sqliteCatalogPath },
    storage: await resolveStorage(lakehouse, secrets, reader),
    extensionDirectory: lakehouse.extensionDirectory,
  };
}

async function resolveStorage(
  lakehouse: LakehouseConfig,
  secrets: SecretProvider,
  reader: boolean,
): Promise<LakehouseStorage> {
  const { storage } = lakehouse;
  if (storage.kind === 'folder') {
    return { kind: 'folder', path: storage.dataPath };
  }
  return {
    kind: 's3',
    url: storage.url,
    endpoint: storage.endpoint,
    region: storage.region,
    useSsl: storage.useSsl,
    accessKeyId: await secrets.get(
      reader ? SECRET_KEYS.lakehouseS3ReaderAccessKeyId : SECRET_KEYS.lakehouseS3WriterAccessKeyId,
    ),
    secretAccessKey: await secrets.get(
      reader
        ? SECRET_KEYS.lakehouseS3ReaderSecretAccessKey
        : SECRET_KEYS.lakehouseS3WriterSecretAccessKey,
    ),
  };
}

/** A lakehouse failure as one line: what happened, then what to do about it. */
export function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const remedy = (error as { remedy?: unknown } | undefined)?.remedy;
  return typeof remedy === 'string' ? `${message} → ${remedy}` : message;
}
