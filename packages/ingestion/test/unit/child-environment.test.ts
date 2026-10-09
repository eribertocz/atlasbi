import { afterEach, describe, expect, it, vi } from 'vitest';

import { childEnvironment, type IngestionTarget } from '../../src/index.ts';

const PASSWORD = 'p@ss:w/rd é';
const github = {
  repositories: ['acme/widgets', 'acme/gadgets'],
  apiUrl: 'https://api.github.com',
  token: 'github_pat_x',
};

const postgresTarget: IngestionTarget = {
  lakehouse: {
    catalog: {
      type: 'postgres',
      connectionString: `postgresql://lakehouse_writer:${encodeURIComponent(PASSWORD)}@127.0.0.1:55432/lakehouse`,
    },
    storage: {
      kind: 's3',
      url: 's3://lakehouse/',
      endpoint: '127.0.0.1:3900',
      region: 'garage',
      useSsl: false,
      accessKeyId: 'GKwriter',
      secretAccessKey: 'writer-secret',
    },
    extensionDirectory: '/data/duckdb/extensions',
  },
  dataDirectory: '/data/ingestion',
  github,
};

const sqliteTarget: IngestionTarget = {
  lakehouse: {
    catalog: { type: 'sqlite', path: '/data/lakehouse/catalog.sqlite' },
    storage: { kind: 'folder', path: '/data/lakehouse/files' },
    extensionDirectory: '/data/duckdb/extensions',
  },
  dataDirectory: '/data/ingestion',
  github,
};

describe('the ingestion runner environment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('carries the catalog password apart from its URL, decoded', () => {
    const environment = childEnvironment(postgresTarget);

    expect(environment.PGPASSWORD).toBe(PASSWORD);
    const url = new URL(environment.ATLASBI_LAKEHOUSE_CATALOG_URL ?? '');
    expect([url.username, url.password, url.host, url.pathname]).toEqual([
      'lakehouse_writer',
      '',
      '127.0.0.1:55432',
      '/lakehouse',
    ]);
    expect(
      Object.values(environment).filter((value) => value?.includes(encodeURIComponent(PASSWORD))),
    ).toEqual([]);
  });

  it("passes none of the caller's platform or libpq variables, nor a tool's own configuration", () => {
    vi.stubEnv('ATLASBI_DATABASE_URL', 'postgresql://platform:secret@db/platform');
    vi.stubEnv('ATLASBI_AUTH_SECRET', 'auth-secret');
    vi.stubEnv('PGHOST', 'elsewhere');
    vi.stubEnv('PGPASSWORD', 'not-this-one');
    vi.stubEnv('DESTINATION__DUCKLAKE__CREDENTIALS', 'injected');
    vi.stubEnv('RUNTIME__LOG_LEVEL', 'DEBUG');

    const environment = childEnvironment(postgresTarget);

    expect(environment.ATLASBI_DATABASE_URL).toBeUndefined();
    expect(environment.ATLASBI_AUTH_SECRET).toBeUndefined();
    expect(environment.PGHOST).toBeUndefined();
    expect(environment.PGPASSWORD).toBe(PASSWORD);
    expect(environment.DESTINATION__DUCKLAKE__CREDENTIALS).toBeUndefined();
    expect(environment.RUNTIME__LOG_LEVEL).toBe('ERROR');
  });

  it('turns telemetry and local copies off, and points the tool at its own folder', () => {
    const environment = childEnvironment(sqliteTarget, { requestAttempts: 1, debug: true });

    /* eslint-disable @typescript-eslint/naming-convention -- dlt's variables, SECTION__KEY. */
    expect(environment).toMatchObject({
      ATLASBI_INGESTION_MODE: 'platform',
      ATLASBI_INGESTION_DATA_PATH: '/data/ingestion',
      RUNTIME__DLTHUB_TELEMETRY: 'false',
      LOAD__DELETE_COMPLETED_JOBS: 'true',
      DLT_PROJECT_DIR: '/data/ingestion',
      RUNTIME__REQUEST_MAX_ATTEMPTS: '1',
      ATLASBI_INGEST_DEBUG: '1',
      ATLASBI_GITHUB_REPOSITORIES: 'acme/widgets,acme/gadgets',
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    expect(environment.PGPASSWORD).toBeUndefined();
    expect(environment.ATLASBI_LAKEHOUSE_CATALOG_URL).toBeUndefined();
    expect(environment.ATLASBI_LAKEHOUSE_SQLITE_PATH).toMatch(
      /\/data\/lakehouse\/catalog\.sqlite$/,
    );
    expect(environment.ATLASBI_LAKEHOUSE_S3_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it('retries requests as the tool does by default, and prints no trace, unless asked', () => {
    const environment = childEnvironment(sqliteTarget);

    expect(environment.RUNTIME__REQUEST_MAX_ATTEMPTS).toBeUndefined();
    expect(environment.ATLASBI_INGEST_DEBUG).toBeUndefined();
    expect(environment.RUNTIME__LOG_LEVEL).toBe('ERROR');
    expect(childEnvironment(sqliteTarget, { debug: true }).RUNTIME__LOG_LEVEL).toBe('WARNING');
  });
});
