import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

interface LakehouseConnection {
  CLIENT_MESSAGE: string;
  describeForLog(error: unknown): string;
  instanceOptions(): Record<string, string>;
  isLakehouseAccessError(error: unknown): boolean;
  lakehouseStatements(env: Record<string, string | undefined>): string[];
}

// The CommonJS module Cube's container loads, tested as is.
const connection = createRequire(import.meta.url)(
  '../../cube/lakehouse-connection.cjs',
) as LakehouseConnection;

const ENV = {
  ATLASBI_LAKEHOUSE_CATALOG_READER_URL:
    "postgres://lakehouse_reader:it's%20secret@127.0.0.1:55432/lakehouse",
  ATLASBI_LAKEHOUSE_CATALOG_HOST: 'postgres',
  ATLASBI_LAKEHOUSE_CATALOG_PORT: '5432',
  ATLASBI_LAKEHOUSE_S3_URL: 's3://lakehouse/data/',
  ATLASBI_LAKEHOUSE_S3_ENDPOINT: 'object-storage:3900',
  ATLASBI_LAKEHOUSE_S3_REGION: 'garage',
  ATLASBI_LAKEHOUSE_S3_USE_SSL: 'false',
  ATLASBI_LAKEHOUSE_S3_READER_ACCESS_KEY_ID: 'GKreader',
  ATLASBI_LAKEHOUSE_S3_READER_SECRET_ACCESS_KEY: 'reader-secret',
};

describe("Cube's lakehouse connection", () => {
  it('never lets DuckDB install or load an extension by itself', () => {
    // DuckDB's option names are the engine's own wire format.
    expect(Object.entries(connection.instanceOptions())).toEqual([
      ['extension_directory', '/duckdb/extensions'],
      ['autoinstall_known_extensions', 'false'],
      ['autoload_known_extensions', 'false'],
      ['allow_unsigned_extensions', 'false'],
    ]);
  });

  it('opens the lakehouse as the reader, in the order of the platform read port', () => {
    const statements = connection.lakehouseStatements(ENV);

    expect(statements.map((statement) => statement.split(' (')[0])).toEqual([
      'LOAD ducklake',
      'LOAD postgres',
      'LOAD httpfs',
      "SET GLOBAL TimeZone = 'UTC'",
      'CREATE TEMPORARY SECRET lake_catalog',
      'CREATE TEMPORARY SECRET lake_storage',
      "ATTACH 'ducklake:postgres:' AS lake",
      "SET GLOBAL allowed_directories = ['s3://lakehouse/data/']",
      'SET GLOBAL enable_external_access = false',
      'SET GLOBAL lock_configuration = true',
    ]);
    expect(statements[6]).toContain('READ_ONLY');
    expect(statements[6]).toContain('CREATE_IF_NOT_EXISTS false');
    // Inside the stack network the catalog is postgres:5432, whatever the host-side URL says.
    expect(statements[4]).toContain("HOST 'postgres', PORT 5432");
    expect(statements[4]).toContain("PASSWORD 'it''s secret'");
    expect(statements[5]).toContain("SCOPE 's3://lakehouse/data/'");
    expect(statements[5]).toContain("KEY_ID 'GKreader'");
  });

  it('names the variable compose did not pass, and refuses an S3 URL DuckLake could not record', () => {
    expect(() =>
      connection.lakehouseStatements({ ...ENV, ATLASBI_LAKEHOUSE_S3_READER_ACCESS_KEY_ID: '' }),
    ).toThrow(/ATLASBI_LAKEHOUSE_S3_READER_ACCESS_KEY_ID is not set/);
    expect(() =>
      connection.lakehouseStatements({ ...ENV, ATLASBI_LAKEHOUSE_S3_URL: 's3://lakehouse/data' }),
    ).toThrow(/must look like s3:\/\/bucket/);
  });

  it('logs the first line of a failure without a credential in it', () => {
    const logged = connection.describeForLog(
      new Error(
        "IO Error: Failed to attach at postgres://lakehouse_reader:hunter2@postgres/lakehouse PASSWORD 'hunter2' SECRET 'reader-secret'\nsecond line",
      ),
    );

    expect(logged).not.toMatch(/hunter2|reader-secret|second line/);
  });

  it('hides lakehouse access failures from clients, but keeps query errors useful', () => {
    expect(
      connection.isLakehouseAccessError(
        new Error("HTTP Error: HTTP GET error reading 'http://object-storage:3900/…' (HTTP 403)"),
      ),
    ).toBe(true);
    expect(
      connection.isLakehouseAccessError(
        new Error('IO Error: Failed to attach DuckLake MetaData … password authentication failed'),
      ),
    ).toBe(true);
    expect(
      connection.isLakehouseAccessError(
        new Error('Binder Error: Referenced column "amont" not found'),
      ),
    ).toBe(false);
    expect(connection.CLIENT_MESSAGE).not.toMatch(/postgres|object-storage|lakehouse_reader/);
  });
});
