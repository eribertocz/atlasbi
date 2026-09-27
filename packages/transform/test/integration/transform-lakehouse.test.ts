import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import { EnvSecretProvider, SECRET_KEYS } from '@atlasbi/config';
import { LakehouseError, type LakehouseCatalogType } from '@atlasbi/contracts';
import { createThrowawayDatabase, type ThrowawayDatabase } from '@atlasbi/database/testing';
import {
  createAnalyticalQueryEngine,
  createLakehouseAdmin,
  provisionLakehouse,
  seedDevelopmentDataset,
  type LakehouseSettings,
} from '@atlasbi/warehouse';
import {
  createTestLakehouse as createWarehouseTestLakehouse,
  testS3Storage,
  type TestLakehouse as WarehouseTestLakehouse,
} from '@atlasbi/warehouse/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runSqlMesh, type TransformTarget } from '../../src/index.ts';
import { extensionDirectory, workspaceEnvironment } from '../support/transform-environment.ts';

async function adminUrl(): Promise<string> {
  workspaceEnvironment();
  return new EnvSecretProvider().get(SECRET_KEYS.databaseUrl);
}

interface TestLakehouse {
  target: Extract<TransformTarget, { mode: 'lakehouse' }>;
  lakehouse: WarehouseTestLakehouse;
  dispose(): Promise<void>;
}

/**
 * A provisioned, seeded, throwaway lakehouse of either tier (postgres: data on S3; sqlite: a data
 * folder) plus a throwaway SQLMesh state database — or the given one, which the caller owns.
 */
async function createTestLakehouse(
  catalogType: LakehouseCatalogType,
  sharedStateConnectionString?: string,
): Promise<TestLakehouse> {
  const lakehouse = await createWarehouseTestLakehouse(catalogType, { provision: false });
  let state: ThrowawayDatabase | undefined;
  try {
    await provisionAndSeed(lakehouse.settings);
    if (sharedStateConnectionString === undefined) {
      state = await createThrowawayDatabase(await adminUrl());
    }
  } catch (error) {
    await lakehouse.dispose().catch(() => undefined);
    throw error;
  }
  return {
    target: {
      mode: 'lakehouse',
      lakehouse: lakehouse.settings,
      stateConnectionString: sharedStateConnectionString ?? state?.connectionString ?? '',
    },
    lakehouse,
    dispose: async () => {
      await state?.drop();
      await lakehouse.dispose();
    },
  };
}

async function provisionAndSeed(lakehouse: LakehouseSettings): Promise<void> {
  await provisionLakehouse(lakehouse);
  const admin = await createLakehouseAdmin(lakehouse);
  try {
    await seedDevelopmentDataset(admin);
  } finally {
    await admin.close();
  }
}

for (const catalogType of ['postgres', 'sqlite'] as const) {
  describe(`SQLMesh on the lakehouse (${catalogType} catalog)`, () => {
    let lakehouse: TestLakehouse;

    beforeAll(async () => {
      lakehouse = await createTestLakehouse(catalogType);
    });

    afterAll(async () => {
      await lakehouse.dispose();
    });

    it('plans and applies the project, audits passing', async () => {
      const run = await runSqlMesh(lakehouse.target, ['plan', '--auto-apply', '--no-prompts'], {
        output: 'capture',
      });

      expect(run.exitCode, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).toContain('audits passed');
      const { storage } = lakehouse.target.lakehouse;
      if (storage.kind === 's3') {
        expect(run.stdout + run.stderr).not.toContain(storage.secretAccessKey);
      }
    });

    it('produces a mart the platform reads losslessly through its read-only port', async () => {
      const port = await createAnalyticalQueryEngine(lakehouse.target.lakehouse);
      try {
        const mart = await port.query(
          'SELECT count(*), sum(amount), count(DISTINCT region), min(order_date), max(order_date) FROM lake.marts.mart_sales_orders',
        );
        const staging = await port.query('SELECT count(*) FROM lake.staging.stg_sales_orders');

        expect(mart.rows).toEqual([['20000', '5243402.47', '5', '2025-01-01', '2025-12-31']]);
        expect(mart.columns.map((column) => column.type.kind)).toEqual([
          'int64',
          'decimal',
          'int64',
          'date',
          'date',
        ]);
        expect(staging.rows).toEqual([['20000']]);
      } finally {
        await port.close();
      }
    });

    it('stores the mart without per-day partitions, and the staging model as a view only', async () => {
      const files = await lakehouse.lakehouse.listDataFiles();
      const martFiles = files.filter(
        (file) => file.startsWith('sqlmesh__marts/') && file.endsWith('.parquet'),
      );

      expect(martFiles).toHaveLength(1);
      expect(martFiles.some((file) => file.includes('='))).toBe(false);
      expect(files.some((file) => file.startsWith('sqlmesh__staging/'))).toBe(false);
    });

    it('runs pending intervals and audits again, idempotently', async () => {
      const run = await runSqlMesh(lakehouse.target, ['run'], { output: 'capture' });
      const audit = await runSqlMesh(lakehouse.target, ['audit'], { output: 'capture' });

      expect(run.exitCode, run.stdout + run.stderr).toBe(0);
      expect(audit.exitCode, audit.stdout + audit.stderr).toBe(0);
    });
  });
}

// A shared state answers "No changes" for a lakehouse that never built the models (reproduced
// live in build step 2): the state belongs to one lakehouse, keyed by its identity.
describe('SQLMesh state belongs to one lakehouse', () => {
  it('builds the mart in each of two lakehouses that share a state database', async () => {
    const state = await createThrowawayDatabase(await adminUrl());
    const lakehouses: TestLakehouse[] = [];
    try {
      for (const catalogType of ['sqlite', 'postgres'] as const) {
        const lakehouse = await createTestLakehouse(catalogType, state.connectionString);
        lakehouses.push(lakehouse);

        const run = await runSqlMesh(lakehouse.target, ['plan', '--auto-apply', '--no-prompts'], {
          output: 'capture',
        });

        expect(run.exitCode, run.stdout + run.stderr).toBe(0);
        expect(await martRowCount(lakehouse.target.lakehouse)).toBe('20000');
      }
      expect(await stateSchemas(state.connectionString)).toHaveLength(2);
    } finally {
      for (const lakehouse of lakehouses) {
        await lakehouse.dispose();
      }
      await state.drop();
    }
  });

  it('starts from an empty state when the lakehouse is created again at the same location', async () => {
    const lakehouse = await createTestLakehouse('sqlite');
    try {
      const first = await runSqlMesh(lakehouse.target, ['plan', '--auto-apply', '--no-prompts'], {
        output: 'capture',
      });
      expect(first.exitCode, first.stdout + first.stderr).toBe(0);

      // What `pnpm reset:local` + `pnpm bootstrap` do to the lakehouse. The state database is kept
      // on purpose: the worst case for a state keyed by location.
      await rm(lakehouse.lakehouse.root, { recursive: true, force: true });
      await provisionAndSeed(lakehouse.target.lakehouse);
      const second = await runSqlMesh(lakehouse.target, ['plan', '--auto-apply', '--no-prompts'], {
        output: 'capture',
      });

      expect(second.exitCode, second.stdout + second.stderr).toBe(0);
      expect(await martRowCount(lakehouse.target.lakehouse)).toBe('20000');
      expect(await stateSchemas(lakehouse.target.stateConnectionString)).toHaveLength(2);
    } finally {
      await lakehouse.dispose();
    }
  });
});

describe('the runner protects the lakehouse before SQLMesh ever attaches it', () => {
  it('refuses a catalog that was never provisioned, and nothing gets created in it', async () => {
    const empty = await createThrowawayDatabase(await adminUrl());
    const state = await createThrowawayDatabase(await adminUrl());
    try {
      const error: unknown = await runSqlMesh(
        {
          mode: 'lakehouse',
          lakehouse: {
            catalog: { type: 'postgres', connectionString: empty.connectionString },
            storage: await testS3Storage('writer', `tests/${randomUUID()}/`),
            extensionDirectory: extensionDirectory(),
          },
          stateConnectionString: state.connectionString,
        },
        ['fetchdf', 'SELECT 1'],
        { output: 'capture' },
      ).catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(LakehouseError);
      expect((error as LakehouseError).code).toBe('catalog_unreachable');
      expect(await tableCount(empty.connectionString)).toBe(0);
    } finally {
      await empty.drop();
      await state.drop();
    }
  });

  it('rejects a wrong catalog password before SQLMesh runs, without the password in the error', async () => {
    const lakehouse = await createTestLakehouse('postgres');
    try {
      const { lakehouse: settings } = lakehouse.target;
      if (settings.catalog.type !== 'postgres') {
        throw new Error('expected a PostgreSQL catalog');
      }
      const url = new URL(settings.catalog.connectionString);
      url.password = 'wrong-password-step2';

      const error: unknown = await runSqlMesh(
        {
          ...lakehouse.target,
          lakehouse: {
            ...settings,
            catalog: { type: 'postgres', connectionString: url.toString() },
          },
        },
        ['fetchdf', 'SELECT 1'],
        { output: 'capture' },
      ).catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(LakehouseError);
      expect((error as LakehouseError).code).toBe('catalog_unreachable');
      expect((error as Error).message).not.toMatch(/wrong-password-step2|atlasbi-dev-only/);
    } finally {
      await lakehouse.dispose();
    }
  });
});

async function tableCount(connectionString: string): Promise<number> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      "select count(*) from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema')",
    );
    return Number(result.rows[0]?.count);
  } finally {
    await client.end();
  }
}

async function martRowCount(lakehouse: LakehouseSettings): Promise<unknown> {
  const port = await createAnalyticalQueryEngine(lakehouse);
  try {
    return (await port.query('SELECT count(*) FROM lake.marts.mart_sales_orders')).rows[0]?.[0];
  } finally {
    await port.close();
  }
}

async function stateSchemas(connectionString: string): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<{ name: string }>(
      "select schema_name as name from information_schema.schemata where schema_name like 'sqlmesh%' order by 1",
    );
    return result.rows.map((row) => row.name);
  } finally {
    await client.end();
  }
}
