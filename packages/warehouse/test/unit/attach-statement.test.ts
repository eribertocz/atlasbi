import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildAttachStatement } from '../../src/adapters/duckdb/attach-statement.ts';
import { resolveLakehouseLocation } from '../../src/lakehouse-location.ts';
import type { LakehouseStorage } from '../../src/lakehouse-settings.ts';

const S3_STORAGE: LakehouseStorage = {
  kind: 's3',
  url: 's3://lakehouse/data/',
  endpoint: '127.0.0.1:53900',
  region: 'garage',
  useSsl: false,
  accessKeyId: 'GKa71a5b1dde70000000000001',
  secretAccessKey: 'not-a-real-secret',
};

describe('buildAttachStatement', () => {
  it('never lets the runtime create a lakehouse or silently move its data path', () => {
    expect(
      buildAttachStatement({
        catalog: { type: 'postgres' },
        dataPath: 'C:/lake/files/',
        access: 'write',
        overrideDataPath: false,
      }),
    ).toBe(
      "ATTACH 'ducklake:postgres:' AS lake (META_SECRET 'lake_catalog', DATA_PATH 'C:/lake/files/', OVERRIDE_DATA_PATH false, CREATE_IF_NOT_EXISTS false)",
    );
  });

  it('attaches READ_ONLY for the query port', () => {
    expect(
      buildAttachStatement({
        catalog: { type: 'sqlite', path: 'C:/lake/catalog.sqlite' },
        dataPath: 'C:/lake/files/',
        access: 'read',
        overrideDataPath: false,
      }),
    ).toBe(
      "ATTACH 'ducklake:sqlite:C:/lake/catalog.sqlite' AS lake (DATA_PATH 'C:/lake/files/', OVERRIDE_DATA_PATH false, CREATE_IF_NOT_EXISTS false, READ_ONLY)",
    );
  });

  it('allows creation only when provisioning, and overriding the data path only on request', () => {
    const statement = buildAttachStatement({
      catalog: { type: 'sqlite', path: "/o'brien/catalog.sqlite" },
      dataPath: '/copy/files/',
      access: 'provision',
      overrideDataPath: true,
    });

    expect(statement).toContain("'ducklake:sqlite:/o''brien/catalog.sqlite'");
    expect(statement).toContain('OVERRIDE_DATA_PATH true');
    expect(statement).toContain('CREATE_IF_NOT_EXISTS true');
    expect(statement).not.toContain('READ_ONLY');
    expect(statement).not.toContain('AUTOMATIC_MIGRATION');
  });
});

describe('resolveLakehouseLocation', () => {
  it('produces one canonical spelling: absolute, forward slashes, data path ending in /', () => {
    const location = resolveLakehouseLocation({
      catalog: { type: 'sqlite', path: 'lake\\catalog.sqlite' },
      storage: { kind: 'folder', path: 'lake\\files' },
      extensionDirectory: 'ext',
    });

    expect(location.dataPath).toBe(`${path.resolve('lake/files').replaceAll('\\', '/')}/`);
    expect(location.sqliteCatalogPath).toBe(
      path.resolve('lake/catalog.sqlite').replaceAll('\\', '/'),
    );
    expect(location.dataPath).not.toContain('\\');
  });

  it('keeps an S3 URL exactly as the catalog records it, with no catalog file', () => {
    const location = resolveLakehouseLocation({
      catalog: { type: 'postgres', connectionString: 'postgres://u:p@h/lakehouse' },
      storage: S3_STORAGE,
      extensionDirectory: '/ext',
    });

    expect(location).toMatchObject({
      storageKind: 's3',
      dataPath: 's3://lakehouse/data/',
      sqliteCatalogPath: undefined,
    });
  });

  it('refuses an S3 URL DuckLake could not record consistently', () => {
    for (const url of ['s3://lakehouse/data', 'https://lakehouse/data/', 's3://UPPER/data/']) {
      expect(() =>
        resolveLakehouseLocation({
          catalog: { type: 'postgres', connectionString: 'postgres://u:p@h/lakehouse' },
          storage: { ...S3_STORAGE, url },
          extensionDirectory: '/ext',
        }),
      ).toThrow(expect.objectContaining({ code: 'storage_unreachable' }));
    }
  });
});
