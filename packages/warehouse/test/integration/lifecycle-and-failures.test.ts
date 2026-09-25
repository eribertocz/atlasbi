import { existsSync } from 'node:fs';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
import { expectLakehouseError } from '@atlasbi/contracts/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { instanceOptions } from '../../src/adapters/duckdb/instance-initializer.ts';
import {
  createAnalyticalQueryEngine,
  createLakehouseAdmin,
  type LakehouseSettings,
} from '../../src/index.ts';
import { createFakeTelemetry } from '../support/fake-telemetry.ts';
import {
  CATALOG_TYPES,
  createTestLakehouse,
  removeFolder,
  type TestLakehouse,
} from './support/test-lakehouse.ts';

const DEVELOPMENT_PASSWORD = 'atlasbi-dev-only';

function withCatalogUrl(
  settings: LakehouseSettings,
  change: (url: URL) => void,
): LakehouseSettings {
  if (settings.catalog.type !== 'postgres') {
    throw new Error('only for a PostgreSQL catalog');
  }
  const url = new URL(settings.catalog.connectionString);
  change(url);
  return { ...settings, catalog: { type: 'postgres', connectionString: url.toString() } };
}

describe('connection lifecycle (Phase 0, S2)', () => {
  let lakehouse: TestLakehouse;

  beforeAll(async () => {
    lakehouse = await createTestLakehouse('postgres');
    const admin = await createLakehouseAdmin(lakehouse.settings);
    try {
      await admin.execute('CREATE TABLE lake.main.scoped AS SELECT 1 AS answer');
    } finally {
      await admin.close();
    }
  });

  afterAll(async () => {
    await lakehouse.dispose();
  });

  it('gives every connection the lakehouse as default database, also in parallel', async () => {
    const port = await createAnalyticalQueryEngine(lakehouse.settings);
    try {
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          port.query('SELECT current_database(), (SELECT answer FROM scoped)'),
        ),
      );
      for (const result of results) {
        expect(result.rows).toEqual([['lake', 1]]);
      }
    } finally {
      await port.close();
    }
  });

  it('runs the engine in UTC for every connection', async () => {
    const port = await createAnalyticalQueryEngine(lakehouse.settings);
    try {
      const result = await port.query("SELECT current_setting('TimeZone')");
      expect(result.rows).toEqual([['UTC']]);
    } finally {
      await port.close();
    }
  });
});

describe('telemetry against a real lakehouse', () => {
  it('emits stable-convention spans without SQL, literals or credentials', async () => {
    const lakehouse = await createTestLakehouse('postgres');
    const fake = createFakeTelemetry();
    const port = await createAnalyticalQueryEngine(lakehouse.settings, fake.providers);
    try {
      await port.query("SELECT 'hunter2' AS secret_literal");
      await port.query('SELEC 1').catch(() => undefined);

      expect(fake.spans.map((span) => span.name)).toEqual(['SELECT', 'duckdb']);
      for (const span of fake.spans) {
        expect(span.ended).toBe(true);
        expect(Object.keys(span.attributes).sort()).toEqual(
          expect.arrayContaining(['db.namespace', 'db.system.name', 'lakehouse.catalog_type']),
        );
      }
      expect(fake.spans[1]?.attributes['error.type']).toBe('query_failed');
      expect(fake.measurements).toHaveLength(2);
      const recorded = JSON.stringify({ spans: fake.spans, measurements: fake.measurements });
      expect(recorded).not.toMatch(/hunter2|SELEC 1|atlasbi-dev-only|postgres:\/\//);
    } finally {
      await port.close();
      await lakehouse.dispose();
    }
  });
});

describe('failures the runtime must report clearly — never by creating, downloading or leaking', () => {
  for (const catalogType of CATALOG_TYPES) {
    it(`refuses to create a lakehouse at runtime (${catalogType} catalog)`, async () => {
      const lakehouse = await createTestLakehouse(catalogType, { provision: false });
      try {
        const error = await expectLakehouseError(
          createLakehouseAdmin(lakehouse.settings),
          'catalog_unreachable',
        );
        expect(error.remedy).toContain('pnpm bootstrap');
        expect(existsSync(lakehouse.settings.dataPath)).toBe(false);
        if (lakehouse.settings.catalog.type === 'sqlite') {
          expect(existsSync(lakehouse.settings.catalog.path)).toBe(false);
        }
      } finally {
        await lakehouse.dispose();
      }
    });
  }

  it('fails in well under a second, and downloads nothing, when an extension is missing', async () => {
    const lakehouse = await createTestLakehouse('sqlite');
    const emptyExtensions = await mkdtemp(path.join(tmpdir(), 'atlasbi-empty-extensions-'));
    try {
      const started = Date.now();
      const error = await expectLakehouseError(
        createAnalyticalQueryEngine({ ...lakehouse.settings, extensionDirectory: emptyExtensions }),
        'extension_missing',
      );

      expect(Date.now() - started).toBeLessThan(1_000);
      expect(error.remedy).toContain('pnpm bootstrap');
      expect(await readdir(emptyExtensions)).toEqual([]);
    } finally {
      await removeFolder(emptyExtensions);
      await lakehouse.dispose();
    }
  });

  it('rejects a wrong catalog password fast, without retrying and without any password in it', async () => {
    const lakehouse = await createTestLakehouse('postgres');
    try {
      const started = Date.now();
      const error = await expectLakehouseError(
        createLakehouseAdmin(
          withCatalogUrl(lakehouse.settings, (url) => {
            url.password = 'wrong-password-123';
          }),
        ),
        'catalog_unreachable',
      );

      expect(Date.now() - started).toBeLessThan(5_000);
      expect(error.retryable).toBe(false);
      expect(`${error.message} ${error.remedy ?? ''}`).not.toMatch(
        /wrong-password-123|atlasbi-dev-only/,
      );
    } finally {
      await lakehouse.dispose();
    }
  });

  it('reports an unreachable catalog server as retryable, without the password', async () => {
    const lakehouse = await createTestLakehouse('postgres');
    try {
      const error = await expectLakehouseError(
        createLakehouseAdmin(
          withCatalogUrl(lakehouse.settings, (url) => {
            url.port = '1';
          }),
        ),
        'catalog_unreachable',
      );

      expect(error.retryable).toBe(true);
      expect(error.message).not.toContain(DEVELOPMENT_PASSWORD);
    } finally {
      await lakehouse.dispose();
    }
  });

  it('refuses a catalog URL with parameters it would otherwise ignore', async () => {
    const lakehouse = await createTestLakehouse('postgres');
    try {
      const error = await expectLakehouseError(
        createLakehouseAdmin(
          withCatalogUrl(lakehouse.settings, (url) => {
            url.searchParams.set('sslmode', 'require');
          }),
        ),
        'catalog_unreachable',
      );

      expect(error.message).toContain('sslmode');
      expect(error.message).not.toContain(DEVELOPMENT_PASSWORD);
    } finally {
      await lakehouse.dispose();
    }
  });

  for (const catalogType of CATALOG_TYPES) {
    it(`refuses a data path other than the recorded one (${catalogType} catalog)`, async () => {
      const lakehouse = await createTestLakehouse(catalogType);
      try {
        const error = await expectLakehouseError(
          createAnalyticalQueryEngine({
            ...lakehouse.settings,
            dataPath: path.join(lakehouse.root, 'elsewhere'),
          }),
          'data_path_mismatch',
        );

        expect(error.message).toContain(`${lakehouse.settings.dataPath.replaceAll('\\', '/')}/`);
      } finally {
        await lakehouse.dispose();
      }
    });
  }

  for (const persistedFormat of ['0.3', '9.9']) {
    it(`refuses catalog format ${persistedFormat} instead of migrating it`, async () => {
      const lakehouse = await createTestLakehouse('sqlite');
      try {
        await rewriteCatalogFormat(lakehouse, persistedFormat);

        const error = await expectLakehouseError(
          createLakehouseAdmin(lakehouse.settings),
          'catalog_format_mismatch',
        );

        expect(error.message).toBe(
          `The lakehouse catalog format is ${persistedFormat}; this platform reads and writes 1.0.`,
        );
      } finally {
        await lakehouse.dispose();
      }
    });
  }
});

// Test-only surgery on a throwaway SQLite catalog, with the runtime's offline options.
async function rewriteCatalogFormat(lakehouse: TestLakehouse, format: string): Promise<void> {
  if (lakehouse.settings.catalog.type !== 'sqlite') {
    throw new Error('only for a SQLite catalog');
  }
  const catalogPath = lakehouse.settings.catalog.path.replaceAll('\\', '/');
  const instance = await DuckDBInstance.create(
    ':memory:',
    instanceOptions(lakehouse.settings.extensionDirectory.replaceAll('\\', '/')),
  );
  const connection = await instance.connect();
  try {
    await connection.run('LOAD sqlite');
    await connection.run(`ATTACH '${catalogPath}' AS raw (TYPE sqlite)`);
    await connection.run(
      `UPDATE raw.ducklake_metadata SET value = '${format}' WHERE key = 'version'`,
    );
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}
