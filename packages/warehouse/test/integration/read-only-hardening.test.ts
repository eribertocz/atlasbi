import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AnalyticalQueryPort } from '@atlasbi/contracts';
import { expectLakehouseError } from '@atlasbi/contracts/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAnalyticalQueryEngine, createLakehouseAdmin } from '../../src/index.ts';
import {
  CATALOG_TYPES,
  createTestLakehouse,
  type TestLakehouse,
} from './support/test-lakehouse.ts';

const forwardSlashes = (value: string) => value.replaceAll('\\', '/');

// Phase 0, S4: what a READ_ONLY attach alone still allows, and what the platform adds on top.
for (const catalogType of CATALOG_TYPES) {
  describe(`read-only query port hardening (${catalogType} catalog)`, () => {
    let lakehouse: TestLakehouse;
    let port: AnalyticalQueryPort;
    let outsideFile: string;
    let leakFile: string;

    beforeAll(async () => {
      lakehouse = await createTestLakehouse(catalogType);
      const admin = await createLakehouseAdmin(lakehouse.settings);
      try {
        await admin.execute(
          'CREATE TABLE lake.main.guarded AS SELECT range AS id FROM range(1000)',
        );
        await admin.execute('INSERT INTO lake.main.guarded VALUES (-1), (-2)');
      } finally {
        await admin.close();
      }
      outsideFile = forwardSlashes(path.join(lakehouse.root, 'outside-secret.csv'));
      leakFile = forwardSlashes(path.join(lakehouse.root, 'leak.csv'));
      await writeFile(outsideFile, 'secret\nsuper-secret-value\n');
      port = await createAnalyticalQueryEngine(lakehouse.settings);
    });

    afterAll(async () => {
      await port.close();
      await lakehouse.dispose();
    });

    it('refuses every write, escape and reconfiguration attempt', async () => {
      const attempts = [
        'INSERT INTO guarded VALUES (99)',
        'CREATE TABLE lake.main.intruder (a INTEGER)',
        "CALL ducklake_flush_inlined_data('lake')",
        "SELECT * FROM ducklake_flush_inlined_data('lake')",
        "SELECT * FROM ducklake_merge_adjacent_files('lake')",
        'DELETE FROM __ducklake_metadata_lake.ducklake_snapshot',
        `COPY (SELECT 1) TO '${leakFile}'`,
        `SELECT * FROM read_csv('${outsideFile}')`,
        `ATTACH '${forwardSlashes(path.join(lakehouse.root, 'other.duckdb'))}' AS other`,
        'INSTALL httpfs',
        'SET enable_external_access = true',
        'SET threads = 1',
        'DETACH lake',
        'USE memory',
        'CREATE TEMP TABLE scratch AS SELECT 1',
        "CREATE SECRET intruder (TYPE postgres, HOST 'evil')",
        'DROP SECRET lake_catalog',
      ];

      const filesBefore = await readdir(lakehouse.settings.dataPath, { recursive: true });
      for (const statement of attempts) {
        await expectLakehouseError(port.query(statement), 'read_only_violation', statement);
      }
      expect(existsSync(leakFile)).toBe(false);
      // A rejected flush used to write its Parquet file before failing: nothing may appear on disk.
      expect(await readdir(lakehouse.settings.dataPath, { recursive: true })).toEqual(filesBefore);
      await expect(port.query('SELECT count(*) FROM guarded')).resolves.toMatchObject({
        rows: [['1002']],
      });
    });

    // Accepted residual, documented as a blocker before the SQL Lab (docs/08 §10.3): a single
    // SELECT can still read the catalog's internal tables and the Parquet files of the lakehouse.
    it('still allows the documented residual reads — and never shows a credential', async () => {
      const metadata = await port.query(
        'SELECT count(*) FROM __ducklake_metadata_lake.ducklake_snapshot',
      );
      const parquet = await port.query(
        `SELECT count(*) FROM read_parquet('${forwardSlashes(lakehouse.settings.dataPath)}/main/guarded/**/*.parquet')`,
      );
      const secrets = await port.query('SELECT * FROM duckdb_secrets()');

      expect(Number(metadata.rows[0]?.[0])).toBeGreaterThan(0);
      expect(parquet.rows).toEqual([['1000']]);
      expect(JSON.stringify(secrets.rows)).not.toContain('atlasbi-dev-only');
    });
  });
}
