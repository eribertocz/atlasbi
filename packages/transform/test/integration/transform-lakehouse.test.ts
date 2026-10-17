import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import { EnvSecretProvider, SECRET_KEYS } from '@atlasbi/config';
import { getDataContract, type LakehouseCatalogType } from '@atlasbi/contracts';
import { findDataContractViolations } from '@atlasbi/contracts-testing';
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
  writeContractView,
} from '@atlasbi/warehouse/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PRODUCED_DATA_CONTRACTS, runTransformJob, type TransformTarget } from '../../src/index.ts';
import { GITHUB_LANDING_ROWS, githubLandingContract } from '../support/landing-fixture.ts';
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
    await writeContractView(admin, githubLandingContract(), GITHUB_LANDING_ROWS);
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

    it('deploys the project, every model built and its audits passing', async () => {
      const { summary, stderr } = await runTransformJob('deploy', lakehouse.target, {
        output: 'capture',
      });

      expect(summary, stderr).toMatchObject({ status: 'succeeded', exitCode: 0 });
      expect(summary.changes?.changed).toBe(true);
      expect(summary.changes?.models).toEqual(
        expect.arrayContaining(['marts.mart_sales_orders', 'marts.mart_github_repo_events']),
      );
      const marts = summary.models.filter(({ model }) => model.startsWith('marts.'));
      expect(marts.map(({ model }) => model).sort()).toEqual([
        'marts.mart_github_repo_events',
        'marts.mart_sales_orders',
      ]);
      expect(marts.every((mart) => mart.auditsPassed > 0 && mart.auditsFailed === 0)).toBe(true);
      const { storage } = lakehouse.target.lakehouse;
      if (storage.kind === 's3') {
        expect(JSON.stringify(summary) + stderr).not.toContain(storage.secretAccessKey);
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

    it('turns the GitHub landing into its mart: every event once, timestamps kept as instants', async () => {
      const port = await createAnalyticalQueryEngine(lakehouse.target.lakehouse);
      try {
        const mart = await port.query(
          `SELECT count(*), count(DISTINCT repository), count(actor), min(created_at), max(created_at)
           FROM lake.marts.mart_github_repo_events`,
        );

        expect(mart.rows).toEqual([
          [String(GITHUB_LANDING_ROWS.length), '2', '4', expect.any(String), expect.any(String)],
        ]);
        expect(mart.columns.map((column) => column.type.kind).slice(3)).toEqual([
          'timestamp_tz',
          'timestamp_tz',
        ]);
        // The read port renders an instant as text (docs/01 §7).
        const [, , , first, last] = mart.rows[0] as unknown as string[];
        expect([Date.parse(first ?? ''), Date.parse(last ?? '')]).toEqual([
          Date.parse('2026-10-01T09:00:00Z'),
          Date.parse('2026-10-03T23:59:59Z'),
        ]);
      } finally {
        await port.close();
      }
    });

    it('publishes every mart as its data contract says (docs/21 §2.4)', async () => {
      const port = await createAnalyticalQueryEngine(lakehouse.target.lakehouse);
      try {
        for (const { id, major } of PRODUCED_DATA_CONTRACTS) {
          const contract = getDataContract(id, major);
          expect(
            await findDataContractViolations(port, contract, { catalog: 'lake' }),
            `${id}@${major}`,
          ).toEqual([]);
        }
      } finally {
        await port.close();
      }
    });

    it('stores the mart without per-day partitions, and the staging model as a view only', async () => {
      const files = await lakehouse.lakehouse.listDataFiles();
      const martFiles = files.filter(
        (file) =>
          file.startsWith('sqlmesh__marts/') &&
          file.includes('mart_sales_orders') &&
          file.endsWith('.parquet'),
      );

      expect(martFiles).toHaveLength(1);
      expect(martFiles.some((file) => file.includes('='))).toBe(false);
      expect(files.some((file) => file.startsWith('sqlmesh__staging/'))).toBe(false);
    });

    it('runs what is pending — nothing, right after a deploy — and checks rules and audits', async () => {
      const run = await runTransformJob('run', lakehouse.target, { output: 'capture' });
      const check = await runTransformJob('check', lakehouse.target, { output: 'capture' });
      const again = await runTransformJob('deploy', lakehouse.target, { output: 'capture' });

      expect(run.summary, run.stderr).toMatchObject({ status: 'succeeded', models: [] });
      expect(check.summary, check.stderr).toMatchObject({
        status: 'succeeded',
        lint: [],
        audits: { passed: true },
      });
      expect(again.summary.changes).toEqual({ changed: false, models: [] });
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

        const { summary, stderr } = await runTransformJob('deploy', lakehouse.target, {
          output: 'capture',
        });

        expect(summary.exitCode, stderr).toBe(0);
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
      const first = await runTransformJob('deploy', lakehouse.target, { output: 'capture' });
      expect(first.summary.exitCode, first.stderr).toBe(0);

      // What `pnpm reset:local` + `pnpm bootstrap` do to the lakehouse. The state database is kept
      // on purpose: the worst case for a state keyed by location.
      await rm(lakehouse.lakehouse.root, { recursive: true, force: true });
      await provisionAndSeed(lakehouse.target.lakehouse);
      const second = await runTransformJob('deploy', lakehouse.target, { output: 'capture' });

      expect(second.summary.exitCode, second.stderr).toBe(0);
      expect(await martRowCount(lakehouse.target.lakehouse)).toBe('20000');
      expect(await stateSchemas(lakehouse.target.stateConnectionString)).toHaveLength(2);
    } finally {
      await lakehouse.dispose();
    }
  });
});

describe('the job protects the lakehouse before the tool ever attaches it', () => {
  it('refuses a catalog that was never provisioned, and nothing gets created in it', async () => {
    const empty = await createThrowawayDatabase(await adminUrl());
    const state = await createThrowawayDatabase(await adminUrl());
    try {
      const { summary } = await runTransformJob(
        'run',
        {
          mode: 'lakehouse',
          lakehouse: {
            catalog: { type: 'postgres', connectionString: empty.connectionString },
            storage: await testS3Storage('writer', `tests/${randomUUID()}/`),
            extensionDirectory: extensionDirectory(),
          },
          stateConnectionString: state.connectionString,
        },
        { output: 'capture' },
      );

      expect([summary.exitCode, summary.error?.code]).toEqual([78, 'configuration_error']);
      expect(await tableCount(empty.connectionString)).toBe(0);
    } finally {
      await empty.drop();
      await state.drop();
    }
  });

  it('rejects a wrong catalog password before the tool runs, without the password in the error', async () => {
    const lakehouse = await createTestLakehouse('postgres');
    try {
      const { lakehouse: settings } = lakehouse.target;
      if (settings.catalog.type !== 'postgres') {
        throw new Error('expected a PostgreSQL catalog');
      }
      const url = new URL(settings.catalog.connectionString);
      url.password = 'wrong-password-step2';

      const { summary } = await runTransformJob(
        'run',
        {
          ...lakehouse.target,
          lakehouse: {
            ...settings,
            catalog: { type: 'postgres', connectionString: url.toString() },
          },
        },
        { output: 'capture' },
      );

      expect([summary.exitCode, summary.error?.code]).toEqual([77, 'credentials_refused']);
      expect(JSON.stringify(summary)).not.toMatch(/wrong-password-step2|atlasbi-dev-only/);
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
      "select schema_name as name from information_schema.schemata where schema_name ~ '^state_[0-9a-f]{32}$' order by 1",
    );
    return result.rows.map((row) => row.name);
  } finally {
    await client.end();
  }
}
