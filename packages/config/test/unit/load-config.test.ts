import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  bootstrapSecretKeys,
  ConfigurationError,
  gatewaySecretKeys,
  lakehouseReaderSecretKeys,
  loadConfig,
  loadLakehouseConfig,
  requiredSecretKeys,
  transformSecretKeys,
} from '../../src/index.ts';

const BASE = path.resolve('/workspace');
const validEnvironment = {
  ATLASBI_ENV: 'development',
  ATLASBI_SECRET_PROVIDER: 'env',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
};

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('loadConfig', () => {
  it('maps environment variables to the domain configuration', () => {
    expect(loadConfig(validEnvironment, { baseDirectory: BASE })).toEqual({
      environment: 'development',
      secretProvider: 'env',
      telemetry: { otlpEndpoint: 'http://127.0.0.1:4318' },
      gateway: { port: 4100, publicUrl: 'http://127.0.0.1:4100' },
      semantic: { url: 'http://127.0.0.1:4000' },
      lakehouse: {
        catalogType: 'postgres',
        storage: {
          kind: 's3',
          url: 's3://lakehouse/data/',
          endpoint: '127.0.0.1:53900',
          region: 'garage',
          useSsl: false,
        },
        sqliteCatalogPath: path.join(BASE, '.data/lakehouse/sqlite/catalog.sqlite'),
        extensionDirectory: path.join(BASE, '.data/duckdb/extensions'),
      },
    });
  });

  it('applies defaults to optional variables, including ones left empty', () => {
    const config = loadConfig({
      ATLASBI_ENV: '',
      ATLASBI_LAKEHOUSE_CATALOG_TYPE: '',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
    });

    expect(config.environment).toBe('development');
    expect(config.secretProvider).toBe('env');
    expect(config.lakehouse.catalogType).toBe('postgres');
  });

  it('reports every invalid variable by name in a single error', () => {
    const error = captureError(() =>
      loadConfig({ ATLASBI_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: '' }),
    );

    expect(error).toBeInstanceOf(ConfigurationError);
    const issues = (error as ConfigurationError).issues.join('\n');
    expect(issues).toContain('ATLASBI_ENV');
    expect(issues).toContain('OTEL_EXPORTER_OTLP_ENDPOINT');
  });
});

describe('gateway configuration (Config Schema v6)', () => {
  it("takes the port, the public address and Cube's address, as origins", () => {
    const config = loadConfig({
      ...validEnvironment,
      ATLASBI_GATEWAY_PORT: '4200',
      ATLASBI_PUBLIC_URL: 'https://bi.example.com/',
      ATLASBI_SEMANTIC_URL: 'http://127.0.0.1:4001',
    });

    expect(config.gateway).toEqual({ port: 4200, publicUrl: 'https://bi.example.com' });
    expect(config.semantic).toEqual({ url: 'http://127.0.0.1:4001' });
  });

  it('refuses a public address with a path or another scheme, and a port out of range', () => {
    for (const [name, value] of [
      ['ATLASBI_PUBLIC_URL', 'http://127.0.0.1:4100/app'],
      ['ATLASBI_PUBLIC_URL', 'ftp://bi.example.com'],
      ['ATLASBI_PUBLIC_URL', 'http://127.0.0.1:4100/?x=1'],
      ['ATLASBI_SEMANTIC_URL', 'not a url'],
      ['ATLASBI_GATEWAY_PORT', '70000'],
    ] as const) {
      const error = captureError(() => loadConfig({ ...validEnvironment, [name]: value }));
      expect(error, `${name}=${value}`).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).issues.join('\n')).toContain(name);
    }
  });

  it('gives the gateway the database, identity and — on the postgres tier — Cube secrets', () => {
    expect(gatewaySecretKeys(loadLakehouseConfig({}))).toEqual([
      'database.url',
      'auth.secret',
      'semantic.api-secret',
    ]);
    expect(
      gatewaySecretKeys(loadLakehouseConfig({ ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'sqlite' })),
    ).toEqual(['database.url', 'auth.secret']);
  });
});

describe('lakehouse configuration (Config Schema v4)', () => {
  it('keeps the portable tier (sqlite) in a data folder, by default or where it is set', () => {
    const sqlite = loadLakehouseConfig(
      { ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'sqlite' },
      { baseDirectory: BASE },
    );
    const explicit = loadLakehouseConfig(
      {
        ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'sqlite',
        ATLASBI_LAKEHOUSE_DATA_PATH: 'lake/files',
        ATLASBI_DUCKDB_EXTENSION_DIRECTORY: '/ext',
      },
      { baseDirectory: BASE },
    );

    expect(sqlite.storage).toEqual({
      kind: 'folder',
      dataPath: path.join(BASE, '.data/lakehouse/sqlite/files'),
    });
    expect(explicit.storage).toEqual({ kind: 'folder', dataPath: path.join(BASE, 'lake/files') });
    expect(explicit.extensionDirectory).toBe(path.resolve('/ext'));
  });

  it('keeps the postgres tier in S3, with every S3 setting overridable', () => {
    const custom = loadLakehouseConfig({
      ATLASBI_LAKEHOUSE_S3_URL: 's3://analytics-prod/lake/v1/',
      ATLASBI_LAKEHOUSE_S3_ENDPOINT: 'objects.internal:443',
      ATLASBI_LAKEHOUSE_S3_REGION: 'eu-west-1',
      ATLASBI_LAKEHOUSE_S3_USE_SSL: 'true',
    });

    expect(custom.storage).toEqual({
      kind: 's3',
      url: 's3://analytics-prod/lake/v1/',
      endpoint: 'objects.internal:443',
      region: 'eu-west-1',
      useSsl: true,
    });
  });

  it('refuses the storage of the other tier instead of ignoring it (decision D1)', () => {
    const postgresWithFolder = captureError(() =>
      loadLakehouseConfig({ ATLASBI_LAKEHOUSE_DATA_PATH: 'lake/files' }),
    );
    const sqliteWithS3 = captureError(() =>
      loadLakehouseConfig({
        ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'sqlite',
        ATLASBI_LAKEHOUSE_S3_URL: 's3://lakehouse/data/',
        ATLASBI_LAKEHOUSE_S3_ENDPOINT: '127.0.0.1:53900',
      }),
    );

    expect((postgresWithFolder as ConfigurationError).issues).toEqual([
      expect.stringMatching(/^ATLASBI_LAKEHOUSE_DATA_PATH: .*portable tier .*S3/),
    ]);
    expect((sqliteWithS3 as ConfigurationError).issues).toEqual([
      expect.stringMatching(/^ATLASBI_LAKEHOUSE_S3_URL: .*portable tier/),
      expect.stringMatching(/^ATLASBI_LAKEHOUSE_S3_ENDPOINT: .*portable tier/),
    ]);
  });

  it('rejects an S3 URL or endpoint DuckLake could not use, naming the variable', () => {
    const cases = [
      { ATLASBI_LAKEHOUSE_S3_URL: 's3://lakehouse/data' },
      { ATLASBI_LAKEHOUSE_S3_URL: 'https://lakehouse/data/' },
      { ATLASBI_LAKEHOUSE_S3_URL: 's3://Upper_Case/' },
      { ATLASBI_LAKEHOUSE_S3_ENDPOINT: 'http://127.0.0.1:53900' },
      { ATLASBI_LAKEHOUSE_S3_ENDPOINT: '127.0.0.1:53900/path' },
      { ATLASBI_LAKEHOUSE_S3_USE_SSL: 'yes' },
    ];

    for (const environment of cases) {
      const [name] = Object.keys(environment);
      const error = captureError(() => loadLakehouseConfig(environment));
      expect(error, name).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).issues[0], name).toMatch(new RegExp(`^${name}: `));
    }
  });

  it('rejects a DuckDB-file catalog and explains why', () => {
    const error = captureError(() =>
      loadLakehouseConfig({ ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'duckdb' }),
    );

    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as ConfigurationError).issues).toEqual([
      'ATLASBI_LAKEHOUSE_CATALOG_TYPE: a DuckDB-file catalog allows a single client only and is not supported — use postgres (default) or sqlite (docs/01 §6.6)',
    ]);
  });

  it('rejects an unknown catalog type by name', () => {
    const error = captureError(() =>
      loadLakehouseConfig({ ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'mysql' }),
    );

    expect(error).toBeInstanceOf(ConfigurationError);
    const [issue] = (error as ConfigurationError).issues;
    expect(issue).toContain('ATLASBI_LAKEHOUSE_CATALOG_TYPE');
    expect(issue).toContain('postgres');
  });

  it('requires the writer secrets (catalog owner + S3 writer key) only for the postgres tier', () => {
    const postgres = loadLakehouseConfig({});
    const sqlite = loadLakehouseConfig({ ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'sqlite' });

    expect(requiredSecretKeys(postgres)).toEqual([
      'database.url',
      'lakehouse.catalog-url',
      'lakehouse.s3-writer-access-key-id',
      'lakehouse.s3-writer-secret-access-key',
    ]);
    expect(requiredSecretKeys(sqlite)).toEqual(['database.url']);
  });

  it('keeps the reader secrets apart: SELECT-only catalog role and read-only S3 key', () => {
    expect(lakehouseReaderSecretKeys(loadLakehouseConfig({}))).toEqual([
      'lakehouse.catalog-reader-url',
      'lakehouse.s3-reader-access-key-id',
      'lakehouse.s3-reader-secret-access-key',
    ]);
    expect(
      lakehouseReaderSecretKeys(loadLakehouseConfig({ ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'sqlite' })),
    ).toEqual([]);
  });

  it('adds the SQLMesh state database for transformations only', () => {
    expect(
      transformSecretKeys(loadLakehouseConfig({ ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'sqlite' })),
    ).toEqual(['database.url', 'transform.state-url']);
    expect(transformSecretKeys(loadLakehouseConfig({}))).toContain('transform.state-url');
  });

  it('gives bootstrap everything it sets up, including the storage administration', () => {
    const keys = bootstrapSecretKeys(loadLakehouseConfig({}));

    expect(keys).toEqual(
      expect.arrayContaining([
        'transform.state-url',
        'lakehouse.catalog-reader-url',
        'lakehouse.s3-reader-secret-access-key',
        'object-storage.admin-token',
        'semantic.api-secret',
        'auth.secret',
      ]),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      bootstrapSecretKeys(loadLakehouseConfig({ ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'sqlite' })),
    ).toEqual(['database.url', 'transform.state-url', 'auth.secret']);
  });
});
