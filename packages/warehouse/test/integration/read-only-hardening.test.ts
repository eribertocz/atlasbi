import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AnalyticalQueryPort } from '@atlasbi/contracts';
import { expectLakehouseError } from '@atlasbi/contracts-testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createAnalyticalQueryEngine,
  createLakehouseAdmin,
  resolveLakehouseLocation,
} from '../../src/index.ts';
import {
  CATALOG_TYPES,
  createTestLakehouse,
  withLakehouseConnection,
  type TestLakehouse,
} from './support/test-lakehouse.ts';

const forwardSlashes = (value: string) => value.replaceAll('\\', '/');

// Phase 0, S4: what a READ_ONLY attach alone still allows, and what the platform adds on top —
// measured again in build step 3 with the data path on S3 (P3-4).
for (const catalogType of CATALOG_TYPES) {
  describe(`read-only query port hardening (${catalogType} catalog)`, () => {
    let lakehouse: TestLakehouse;
    let port: AnalyticalQueryPort;
    let dataPath: string;
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
      dataPath = resolveLakehouseLocation(lakehouse.settings).dataPath;
      outsideFile = forwardSlashes(path.join(lakehouse.root, 'outside-secret.csv'));
      leakFile = forwardSlashes(path.join(lakehouse.root, 'leak.csv'));
      await writeFile(outsideFile, 'secret\nsuper-secret-value\n');
      // The reader identity: SELECT-only catalog role and read-only S3 key on the postgres tier.
      port = await createAnalyticalQueryEngine(lakehouse.readerSettings);
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
        `COPY (SELECT 1) TO '${dataPath}leak.parquet'`,
        `SELECT * FROM read_csv('${outsideFile}')`,
        `ATTACH '${forwardSlashes(path.join(lakehouse.root, 'other.duckdb'))}' AS other`,
        'INSTALL httpfs',
        'SET enable_external_access = true',
        "SET s3_endpoint = 'evil.example:80'",
        'SET threads = 1',
        'DETACH lake',
        'USE memory',
        'CREATE TEMP TABLE scratch AS SELECT 1',
        "CREATE SECRET intruder (TYPE postgres, HOST 'evil')",
        "CREATE SECRET intruder (TYPE s3, KEY_ID 'a', SECRET 'b', ENDPOINT 'evil.example')",
        'DROP SECRET lake_catalog',
      ];

      const filesBefore = await lakehouse.listDataFiles();
      for (const statement of attempts) {
        await expectLakehouseError(port.query(statement), 'read_only_violation', statement);
      }
      expect(existsSync(leakFile)).toBe(false);
      // A rejected flush used to write its Parquet file before failing: nothing may appear.
      expect(await lakehouse.listDataFiles()).toEqual(filesBefore);
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
        `SELECT count(*) FROM read_parquet('${dataPath}main/guarded/**/*.parquet')`,
      );
      const secrets = JSON.stringify((await port.query('SELECT * FROM duckdb_secrets()')).rows);

      expect(Number(metadata.rows[0]?.[0])).toBeGreaterThan(0);
      expect(parquet.rows).toEqual([['1000']]);
      expect(secrets).not.toContain('atlasbi-dev-only');
      if (lakehouse.readerSettings.storage.kind === 's3') {
        expect(secrets).not.toContain(lakehouse.readerSettings.storage.secretAccessKey);
      }
    });

    if (catalogType === 'postgres') {
      it('reaches nothing on the network but its own data path', async () => {
        const bucket = new URL(dataPath).host;
        const attempts = [
          `SELECT count(*) FROM read_parquet('s3://${bucket}/data/**/*.parquet')`,
          `SELECT count(*) FROM glob('s3://${bucket}/**')`,
          "SELECT * FROM read_parquet('s3://another-bucket/x.parquet')",
          "SELECT * FROM read_text('http://169.254.169.254/latest/meta-data/')",
          "SELECT * FROM read_csv('https://example.com/data.csv')",
        ];

        for (const statement of attempts) {
          await expectLakehouseError(port.query(statement), 'read_only_violation', statement);
        }
      });

      // The query port's guard stops these first; the server must refuse them on its own too,
      // for a reader that has no guard (Cube) — P3-4 and P3-13.
      it('holds even below the guard: the reader key cannot write, the reader role cannot commit', async () => {
        const writableReader = lakehouse.readerSettings;

        await expect(
          withLakehouseConnection(writableReader, (connection) =>
            connection.run(`COPY (SELECT 1 AS x) TO '${dataPath}engine-level-leak.parquet'`),
          ),
        ).rejects.toThrow(/403/);
        await expect(
          withLakehouseConnection(writableReader, (connection) =>
            connection.run('INSERT INTO lake.main.guarded VALUES (42)'),
          ),
        ).rejects.toThrow();
        expect(await lakehouse.listDataFiles()).not.toContain('engine-level-leak.parquet');
        await expect(port.query('SELECT count(*) FROM guarded')).resolves.toMatchObject({
          rows: [['1002']],
        });
      });
    }
  });
}
