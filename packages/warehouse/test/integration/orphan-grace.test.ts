import { MIN_ORPHAN_GRACE_HOURS } from '@atlasbi/contracts';
import { describe, expect, it } from 'vitest';

import { readRows } from '../../src/adapters/duckdb/internal-reads.ts';
import { LakehouseEngine } from '../../src/adapters/duckdb/lakehouse-engine.ts';
import { createAnalyticalQueryEngine, createLakehouseAdmin } from '../../src/index.ts';
import { createTestLakehouse } from './support/test-lakehouse.ts';

// Regression of a Plan C, Phase 0 finding: DuckLake's orphan sweep cannot tell a file a writer has
// uploaded but not committed yet from a real orphan. Swept with no grace, the writer still commits —
// and its table then points at files that no longer exist. Hence MIN_ORPHAN_GRACE_HOURS, refused
// below by configuration, the command line and the port. If the first test ever stops failing the
// table, DuckLake changed and the floor can be revisited.
describe('orphan files and a writer in the middle of its transaction (PostgreSQL catalog)', () => {
  /**
   * A writer uploads its files inside an open transaction; `sweep` runs before it commits. Returns
   * what the sweep reported and whether the table can still be read in full afterwards.
   */
  async function writeAcrossSweep(
    sweep: (settings: Parameters<typeof createLakehouseAdmin>[0]) => Promise<number>,
  ) {
    const lakehouse = await createTestLakehouse('postgres');
    try {
      const setup = await createLakehouseAdmin(lakehouse.settings);
      await setup.execute('CREATE TABLE lake.main.events (id BIGINT)');
      await setup.execute('INSERT INTO lake.main.events SELECT range FROM range(1000)');
      await setup.close();

      const writer = await LakehouseEngine.open(lakehouse.settings, 'write');
      let swept = 0;
      try {
        await writer.run('INSERT', async (connection) => {
          await connection.run('BEGIN TRANSACTION');
          // Well above the inlining limit: the rows go to Parquet files, uploaded now.
          await connection.run(
            'INSERT INTO lake.main.events SELECT range FROM range(1000, 201000)',
          );
          swept = await sweep(lakehouse.settings);
          await connection.run('COMMIT');
        });
      } finally {
        await writer.close();
      }

      const reader = await createAnalyticalQueryEngine(lakehouse.settings);
      try {
        // A sum reads every file; a count could come from the catalog's statistics alone.
        const read = await reader
          .query('SELECT sum(id) FROM lake.main.events')
          .then((result) => ({ ok: true as const, sum: result.rows[0]?.[0] }))
          .catch((error: unknown) => ({ ok: false as const, error }));
        return { swept, read };
      } finally {
        await reader.close();
      }
    } finally {
      await lakehouse.dispose();
    }
  }

  it('deletes the files of an uncommitted write when swept with no grace: the table loses them', async () => {
    const { swept, read } = await writeAcrossSweep(async (settings) => {
      const sweeper = await LakehouseEngine.open(settings, 'write');
      try {
        const statement =
          "SELECT * FROM ducklake_delete_orphaned_files('lake', older_than => now())";
        return (await sweeper.run(statement, (connection) => readRows(connection, statement)))
          .length;
      } finally {
        await sweeper.close();
      }
    });

    expect(swept).toBeGreaterThan(0);
    expect(read.ok).toBe(false);
  });

  it("keeps them under the platform's maintenance, even at its smallest grace", async () => {
    const { swept, read } = await writeAcrossSweep(async (settings) => {
      const admin = await createLakehouseAdmin(settings);
      try {
        const report = await admin.maintain({
          snapshotRetentionDays: 7,
          cleanupGraceMinutes: 0,
          orphanGraceHours: MIN_ORPHAN_GRACE_HOURS,
        });
        return report.deletedOrphans;
      } finally {
        await admin.close();
      }
    });

    expect(swept).toBe(0);
    expect(read).toEqual({ ok: true, sum: String((201000 * 200999) / 2) });
  });
});
