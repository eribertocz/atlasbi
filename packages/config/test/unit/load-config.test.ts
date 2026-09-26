import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ConfigurationError,
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
      lakehouse: {
        catalogType: 'postgres',
        dataPath: path.join(BASE, '.data/lakehouse/postgres/files'),
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

describe('lakehouse configuration (Config Schema v2)', () => {
  it('keeps one data folder per catalog type unless a data path is set', () => {
    const sqlite = loadLakehouseConfig(
      { ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'sqlite' },
      { baseDirectory: BASE },
    );
    const explicit = loadLakehouseConfig(
      { ATLASBI_LAKEHOUSE_DATA_PATH: 'lake/files', ATLASBI_DUCKDB_EXTENSION_DIRECTORY: '/ext' },
      { baseDirectory: BASE },
    );

    expect(sqlite.dataPath).toBe(path.join(BASE, '.data/lakehouse/sqlite/files'));
    expect(explicit.dataPath).toBe(path.join(BASE, 'lake/files'));
    expect(explicit.extensionDirectory).toBe(path.resolve('/ext'));
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

  it('requires the catalog URL secret only for a PostgreSQL catalog', () => {
    const postgres = loadLakehouseConfig({});
    const sqlite = loadLakehouseConfig({ ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'sqlite' });

    expect(requiredSecretKeys(postgres)).toEqual(['database.url', 'lakehouse.catalog-url']);
    expect(requiredSecretKeys(sqlite)).toEqual(['database.url']);
  });

  it('adds the SQLMesh state database for transformations only', () => {
    expect(transformSecretKeys(loadLakehouseConfig({}))).toEqual([
      'database.url',
      'lakehouse.catalog-url',
      'transform.state-url',
    ]);
    expect(
      transformSecretKeys(loadLakehouseConfig({ ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'sqlite' })),
    ).toEqual(['database.url', 'transform.state-url']);
  });
});
