import { describe, expect, it } from 'vitest';

import { createStorageSecretStatement } from '../../src/adapters/duckdb/storage-secret.ts';
import type { LakehouseStorage } from '../../src/lakehouse-settings.ts';

const STORAGE: Extract<LakehouseStorage, { kind: 's3' }> = {
  kind: 's3',
  url: 's3://lakehouse/data/',
  endpoint: '127.0.0.1:53900',
  region: 'garage',
  useSsl: false,
  accessKeyId: 'GKa71a5b1dde70000000000001',
  secretAccessKey: "it's-a-secret",
};

describe('createStorageSecretStatement', () => {
  it('scopes the key to the lakehouse data path, with path-style URLs', () => {
    const statement = createStorageSecretStatement(STORAGE, 's3://lakehouse/data/');

    expect(statement).toBe(
      "CREATE TEMPORARY SECRET lake_storage (TYPE s3, KEY_ID 'GKa71a5b1dde70000000000001', SECRET 'it''s-a-secret', ENDPOINT '127.0.0.1:53900', REGION 'garage', URL_STYLE 'path', USE_SSL false, SCOPE 's3://lakehouse/data/')",
    );
  });

  it('refuses an endpoint with a scheme or a path, which DuckDB would misread', () => {
    for (const endpoint of ['http://127.0.0.1:53900', '127.0.0.1:53900/bucket', 'host name:1']) {
      expect(() =>
        createStorageSecretStatement({ ...STORAGE, endpoint }, 's3://lakehouse/data/'),
      ).toThrow(expect.objectContaining({ code: 'storage_unreachable' }));
    }
  });
});
