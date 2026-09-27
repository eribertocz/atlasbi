import { LakehouseError } from '@atlasbi/contracts';

import type { LakehouseStorage } from '../../lakehouse-settings.ts';
import { quoteLiteral } from './sql-literals.ts';

/** Name of the DuckDB secret holding the object storage key (never persisted). */
export const STORAGE_SECRET_NAME = 'lake_storage';

type S3Storage = Extract<LakehouseStorage, { kind: 's3' }>;

// host:port, never a scheme or a path: DuckDB builds the URL from it and USE_SSL.
const ENDPOINT = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::\d{1,5})?$/;

/**
 * The key reaches DuckDB as a secret scoped to the lakehouse's own data path, never inside a URL:
 * any other path — another prefix, another bucket — gets no credentials at all. Path-style URLs,
 * because a self-hosted server has no wildcard DNS for virtual-hosted buckets.
 */
export function createStorageSecretStatement(storage: S3Storage, dataPath: string): string {
  if (!ENDPOINT.test(storage.endpoint)) {
    throw new LakehouseError(
      'storage_unreachable',
      'The lakehouse S3 endpoint is unusable: it must be host:port, without a scheme or a path.',
      { remedy: 'Fix ATLASBI_LAKEHOUSE_S3_ENDPOINT (docs/11 §4.4).' },
    );
  }
  return (
    `CREATE TEMPORARY SECRET ${STORAGE_SECRET_NAME} (TYPE s3, ` +
    `KEY_ID ${quoteLiteral(storage.accessKeyId)}, SECRET ${quoteLiteral(storage.secretAccessKey)}, ` +
    `ENDPOINT ${quoteLiteral(storage.endpoint)}, REGION ${quoteLiteral(storage.region)}, ` +
    `URL_STYLE 'path', USE_SSL ${storage.useSsl}, SCOPE ${quoteLiteral(dataPath)})`
  );
}
