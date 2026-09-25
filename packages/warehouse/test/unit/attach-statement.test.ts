import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildAttachStatement } from '../../src/adapters/duckdb/attach-statement.ts';
import { resolveLakehouseLocation } from '../../src/lakehouse-location.ts';

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
      dataPath: 'lake\\files',
      extensionDirectory: 'ext',
    });

    expect(location.dataPath).toBe(`${path.resolve('lake/files').replaceAll('\\', '/')}/`);
    expect(location.sqliteCatalogPath).toBe(
      path.resolve('lake/catalog.sqlite').replaceAll('\\', '/'),
    );
    expect(location.dataPath).not.toContain('\\');
  });

  it('has no catalog file for a PostgreSQL catalog', () => {
    const location = resolveLakehouseLocation({
      catalog: { type: 'postgres', connectionString: 'postgres://u:p@h/lakehouse' },
      dataPath: '/lake/files/',
      extensionDirectory: '/ext',
    });

    expect(location.sqliteCatalogPath).toBeUndefined();
    expect(location.dataPath.endsWith('/files/')).toBe(true);
  });
});
