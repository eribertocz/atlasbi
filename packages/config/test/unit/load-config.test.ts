import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  bootstrapSecretKeys,
  ConfigurationError,
  gatewaySecretKeys,
  ingestionSecretKeys,
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
      gateway: {
        host: '127.0.0.1',
        port: 4100,
        publicUrl: 'http://127.0.0.1:3000',
        trustedProxies: [],
      },
      web: { port: 3000 },
      semantic: { enabled: true, url: 'http://127.0.0.1:4000' },
      ingestion: {
        dataPath: path.join(BASE, '.data', 'ingestion'),
        github: { repositories: [], apiUrl: 'https://api.github.com' },
      },
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
        retention: { snapshotRetentionDays: 7, cleanupGraceMinutes: 60, orphanGraceHours: 24 },
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

    expect(config.gateway).toEqual({
      host: '127.0.0.1',
      port: 4200,
      publicUrl: 'https://bi.example.com',
      trustedProxies: [],
    });
    expect(config.semantic).toEqual({ enabled: true, url: 'http://127.0.0.1:4001' });
    // The portable tier keeps its data where no container reaches: no semantic layer there.
    expect(
      loadConfig({ ...validEnvironment, ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'sqlite' }).semantic
        .enabled,
    ).toBe(false);
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

describe('gateway behind a proxy (Config Schema v7)', () => {
  it('takes the listen address and exactly the trusted proxies, as IPs', () => {
    const config = loadConfig({
      ...validEnvironment,
      ATLASBI_GATEWAY_HOST: '0.0.0.0',
      ATLASBI_TRUSTED_PROXIES: ' 10.89.7.2 , fd00::2 ',
      ATLASBI_WEB_PORT: '3100',
    });

    expect(config.gateway).toMatchObject({
      host: '0.0.0.0',
      trustedProxies: ['10.89.7.2', 'fd00::2'],
    });
    expect(config.web).toEqual({ port: 3100 });
  });

  it('refuses anything that is not an IP: a host name, a CIDR, `true`', () => {
    for (const [name, value] of [
      ['ATLASBI_TRUSTED_PROXIES', 'proxy.internal'],
      ['ATLASBI_TRUSTED_PROXIES', '10.0.0.0/8'],
      ['ATLASBI_TRUSTED_PROXIES', 'true'],
      ['ATLASBI_GATEWAY_HOST', 'localhost'],
    ] as const) {
      const error = captureError(() => loadConfig({ ...validEnvironment, [name]: value }));
      expect(error, `${name}=${value}`).toBeInstanceOf(ConfigurationError);
    }
  });
});

describe('ingestion (Config Schema v8)', () => {
  it('has a folder of its own and loads no repository until told to', () => {
    const config = loadConfig(validEnvironment, { baseDirectory: BASE });

    expect(config.ingestion).toEqual({
      dataPath: path.join(BASE, '.data', 'ingestion'),
      github: { repositories: [], apiUrl: 'https://api.github.com' },
    });
  });

  it('takes the repositories as owner/name, and GitHub Enterprise without a trailing slash', () => {
    const config = loadConfig({
      ...validEnvironment,
      ATLASBI_GITHUB_REPOSITORIES: ' duckdb/duckdb , sveltejs/svelte ',
      ATLASBI_GITHUB_API_URL: 'https://github.example.com/api/v3/',
    });

    expect(config.ingestion.github).toEqual({
      repositories: ['duckdb/duckdb', 'sveltejs/svelte'],
      apiUrl: 'https://github.example.com/api/v3',
    });
  });

  it('refuses a repository that is not owner/name, and an API that is not http(s)', () => {
    for (const [name, value] of [
      ['ATLASBI_GITHUB_REPOSITORIES', 'duckdb'],
      ['ATLASBI_GITHUB_REPOSITORIES', 'duckdb/duckdb/extra'],
      ['ATLASBI_GITHUB_API_URL', 'ftp://api.github.com'],
    ] as const) {
      const error = captureError(() => loadConfig({ ...validEnvironment, [name]: value }));
      expect(error, `${name}=${value}`).toBeInstanceOf(ConfigurationError);
    }
  });

  it('writes the landing as the lakehouse writer, with the source token', () => {
    const postgres = loadLakehouseConfig({}, { baseDirectory: BASE });

    expect(ingestionSecretKeys(postgres, 'github')).toEqual([
      'lakehouse.catalog-url',
      'lakehouse.s3-writer-access-key-id',
      'lakehouse.s3-writer-secret-access-key',
      'github.token',
    ]);
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

  it('adds the transformation state database for transformations only', () => {
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

describe('lakehouse retention (Config Schema v9, Plan C)', () => {
  it('keeps 7 days of versions, an hour of cleanup grace and a day of orphan grace by default', () => {
    expect(loadLakehouseConfig({}, { baseDirectory: BASE }).retention).toEqual({
      snapshotRetentionDays: 7,
      cleanupGraceMinutes: 60,
      orphanGraceHours: 24,
    });
  });

  it('never lets .env set an orphan grace under the floor: it would corrupt tables', () => {
    for (const value of ['0', '-1', '0.5']) {
      const error = captureError(() =>
        loadLakehouseConfig(
          { ATLASBI_LAKEHOUSE_ORPHAN_GRACE_HOURS: value },
          { baseDirectory: BASE },
        ),
      );
      expect(error, value).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).issues.join(' '), value).toMatch(
        /ATLASBI_LAKEHOUSE_ORPHAN_GRACE_HOURS/,
      );
    }
    expect(
      loadLakehouseConfig({ ATLASBI_LAKEHOUSE_ORPHAN_GRACE_HOURS: '1' }, { baseDirectory: BASE })
        .retention.orphanGraceHours,
    ).toBe(1);
  });
});
