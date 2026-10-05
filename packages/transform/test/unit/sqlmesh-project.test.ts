import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runSqlMesh, SQLMESH_PROJECT_DIRECTORY, type TransformTarget } from '../../src/index.ts';
import {
  copyProject,
  environmentWithoutPlatformVariables,
  extensionDirectory,
  runInTransformEnvironment,
} from '../support/transform-environment.ts';

// Needs the uv environment `pnpm bootstrap` prepares; no lakehouse, no secrets, no network.
const offline = (): TransformTarget => ({
  mode: 'unit-tests',
  extensionDirectory: extensionDirectory(),
});

describe('SQLMesh project (offline)', () => {
  it('passes its SQLMesh unit tests on an in-memory DuckDB', async () => {
    const run = await runSqlMesh(offline(), ['test'], { output: 'capture' });

    expect(run.exitCode, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toContain('Successfully Ran');
  });

  it('passes the linter, including the platform rule', async () => {
    const run = await runSqlMesh(offline(), ['lint'], { output: 'capture' });

    expect(run.exitCode, run.stdout + run.stderr).toBe(0);
  });

  it('rejects a model that attaches a source on its own (docs/02 §6.1.2)', async () => {
    const project = await copyProject();
    try {
      await writeFile(
        path.join(project.directory, 'models', 'staging', 'stg_intruder.sql'),
        "MODEL (\n  name staging.stg_intruder,\n  kind VIEW\n);\n\nATTACH 'postgres:dbname=elsewhere' AS rogue (TYPE postgres, READ_ONLY);\n\nSELECT 1 AS x\n",
      );

      const run = await runSqlMesh(offline(), ['lint'], {
        output: 'capture',
        projectDirectory: project.directory,
      });

      expect(run.exitCode).not.toBe(0);
      expect(run.stdout + run.stderr).toContain('noplatformmanagedstatements');
      expect(run.stdout + run.stderr).toContain('ATTACH is managed by the platform');
    } finally {
      await project.dispose();
    }
  });

  it("rejects models that read an ingestion tool's metadata or its internal schema (docs/21 §2.4)", async () => {
    const intruders = [
      ['stg_dlt_column', 'SELECT order_id, _dlt_load_id FROM lake.fixture.sales_orders'],
      ['stg_dlt_table', 'SELECT load_id FROM lake.landing_crm._dlt_loads'],
      ['stg_ingestion_schema', 'SELECT id FROM lake.ingestion_crm.opportunity'],
    ] as const;
    const project = await copyProject();
    try {
      for (const [name, query] of intruders) {
        await writeFile(
          path.join(project.directory, 'models', 'staging', `${name}.sql`),
          `MODEL (\n  name staging.${name},\n  kind VIEW\n);\n\n${query}\n`,
        );
      }

      const run = await runSqlMesh(offline(), ['lint'], {
        output: 'capture',
        projectDirectory: project.directory,
      });
      const output = run.stdout + run.stderr;

      expect(run.exitCode).not.toBe(0);
      expect(output).toContain('noingestioninternals');
      expect(output).toContain("_dlt_load_id is the ingestion tool's metadata");
      expect(output).toContain("_dlt_loads is the ingestion tool's metadata");
      expect(output).toContain("ingestion_crm is ingestion's internal schema");
    } finally {
      await project.dispose();
    }
  });

  it('refuses to load when run directly instead of through `pnpm transform`', async () => {
    const run = await runInTransformEnvironment(
      ['sqlmesh', '-p', SQLMESH_PROJECT_DIRECTORY, 'info'],
      environmentWithoutPlatformVariables(),
    );

    expect(run.exitCode).not.toBe(0);
    expect(run.output).toContain('Run SQLMesh through `pnpm transform`');
  });

  it('declares every incremental model without per-day partitions (docs/02 §6.1.1)', async () => {
    const modelsRoot = path.join(SQLMESH_PROJECT_DIRECTORY, 'models');
    const files = await readdir(modelsRoot, { recursive: true });
    const incremental = [];
    for (const file of files.filter((name) => name.endsWith('.sql'))) {
      const sql = await readFile(path.join(modelsRoot, file), 'utf8');
      if (/kind\s+INCREMENTAL_BY_TIME_RANGE/i.test(sql)) {
        incremental.push(file);
        expect(sql, file).toMatch(/partition_by_time_column\s+false/i);
      }
    }
    expect(incremental.length).toBeGreaterThan(0);
  });

  it('keeps Python models and macros off the network (docs/02 §6.1.2)', async () => {
    const forbidden =
      /^\s*(?:import|from)\s+(requests|httpx|aiohttp|urllib3|socket|http\.client|urllib\.request|ftplib|smtplib)\b/m;
    for (const folder of ['models', 'macros']) {
      const root = path.join(SQLMESH_PROJECT_DIRECTORY, folder);
      const files = await readdir(root, { recursive: true }).catch(() => [] as string[]);
      for (const file of files.filter((name) => name.endsWith('.py'))) {
        const source = await readFile(path.join(root, file), 'utf8');
        expect(forbidden.test(source), `${folder}/${file} imports a network module`).toBe(false);
      }
    }
    expect(forbidden.test('import requests')).toBe(true);
    expect(forbidden.test('from urllib.parse import urlparse')).toBe(false);
  });
});
