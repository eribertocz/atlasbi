import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AnalyticalQueryPort } from '@atlasbi/contracts';
import {
  LAKEHOUSE_CATALOG_TYPES,
  type LakehouseAdminPort,
  MIN_ORPHAN_GRACE_HOURS,
} from '@atlasbi/contracts';
import { expectLakehouseError } from './analytical-query-port-contract.ts';

export interface LakehouseAdminPortFixture {
  /** A new admin port over the fixture's lakehouse, provisioned and empty at first; the battery closes it. */
  openAdmin(): Promise<LakehouseAdminPort>;
  /** A read-only port over the same lakehouse; the battery closes it. */
  openQueryPort(): Promise<AnalyticalQueryPort>;
  /** Releases whatever the fixture created. */
  dispose(): Promise<void>;
}

/** Inlining v1 (docs/01): the row limit every writer obeys, persisted in the catalog. */
const INLINING_ROW_LIMIT = 10;

/** The battery every LakehouseAdminPort adapter must pass (docs/21 §3.3). */
export function describeLakehouseAdminPortContract(
  adapterName: string,
  fixture: LakehouseAdminPortFixture,
): void {
  describe(`LakehouseAdminPort contract: ${adapterName}`, () => {
    let admin: LakehouseAdminPort;

    beforeAll(async () => {
      admin = await fixture.openAdmin();
    });

    afterAll(async () => {
      await admin.close();
      await fixture.dispose();
    });

    it('executes one statement at a time and reports affected rows as a string', async () => {
      await admin.execute('CREATE TABLE contract_events (id BIGINT, label VARCHAR)');

      await expect(
        admin.execute("INSERT INTO contract_events SELECT range, 'bulk' FROM range(25)"),
      ).resolves.toEqual({ affectedRows: '25' });
      await expect(
        admin.execute("UPDATE contract_events SET label = 'early' WHERE id < 5"),
      ).resolves.toEqual({ affectedRows: '5' });
      await expect(admin.execute('DELETE FROM contract_events WHERE id >= 20')).resolves.toEqual({
        affectedRows: '5',
      });
    });

    it('binds positional parameters, with bigint passed as a string', async () => {
      await admin.execute('INSERT INTO contract_events VALUES ($1::BIGINT, $2)', [
        '9007199254740993',
        'parameterized',
      ]);

      const reader = await fixture.openQueryPort();
      try {
        const result = await reader.query(
          "SELECT id FROM contract_events WHERE label = 'parameterized'",
        );
        expect(result.rows).toEqual([['9007199254740993']]);
      } finally {
        await reader.close();
      }
    });

    it('makes committed writes visible to a query port opened afterwards', async () => {
      const reader = await fixture.openQueryPort();
      try {
        const result = await reader.query('SELECT count(*) AS n FROM contract_events');
        expect(result.rows).toEqual([['21']]);
      } finally {
        await reader.close();
      }
    });

    it('reports a stable identity, a supported catalog format and the Inlining v1 row limit', async () => {
      const health = await admin.checkHealth();

      expect(health.lakehouseId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect((await admin.checkHealth()).lakehouseId).toBe(health.lakehouseId);
      expect(LAKEHOUSE_CATALOG_TYPES).toContain(health.catalogType);
      expect(health.catalogFormatVersion).toBe('1.0');
      expect(health.engineVersion).not.toBe('');
      expect(health.inlining.rowLimit).toBe(INLINING_ROW_LIMIT);
    });

    it('keeps small writes in the catalog until flushed, without changing any result', async () => {
      await admin.execute('CREATE TABLE contract_small (id BIGINT)');
      await admin.flushInlinedData();

      await admin.execute('INSERT INTO contract_small VALUES (1), (2), (3)');
      const beforeFlush = await admin.checkHealth();
      const flushed = await admin.flushInlinedData();
      const afterFlush = await admin.checkHealth();

      expect(beforeFlush.inlining.pendingRows).toBe('3');
      expect(flushed).toEqual({ rowsFlushed: '3' });
      expect(afterFlush.inlining.pendingRows).toBe('0');
      const reader = await fixture.openQueryPort();
      try {
        const result = await reader.query('SELECT count(*), sum(id) FROM contract_small');
        expect(result.rows).toEqual([['3', '6']]);
      } finally {
        await reader.close();
      }
    });

    it('maintains the lakehouse: a dry run changes nothing, a real run expires and compacts, results unchanged', async () => {
      await admin.execute('CREATE TABLE contract_maintained (id BIGINT)');
      for (let round = 0; round < 4; round += 1) {
        // Above the inlining limit: each insert leaves a data file of its own.
        await admin.execute(
          `INSERT INTO contract_maintained SELECT range + ${round * 100} FROM range(100)`,
        );
      }
      await admin.execute('DELETE FROM contract_maintained WHERE id < 50');
      // A table with one file of deleted rows and one clean file: nothing for compaction to merge.
      await admin.execute('CREATE TABLE contract_deleted (id BIGINT)');
      await admin.execute('INSERT INTO contract_deleted SELECT range FROM range(100)');
      await admin.execute('DELETE FROM contract_deleted WHERE id = 0');
      await admin.execute('INSERT INTO contract_deleted SELECT range FROM range(100, 200)');
      // A table whose own columns change between two loads: its files cannot be merged.
      await admin.execute('CREATE TABLE contract_evolved (id BIGINT)');
      await admin.execute('INSERT INTO contract_evolved SELECT range FROM range(100)');
      await admin.execute('ALTER TABLE contract_evolved ADD COLUMN note VARCHAR');
      await admin.execute("INSERT INTO contract_evolved SELECT range, 'x' FROM range(100, 200)");
      const policy = {
        snapshotRetentionDays: 0,
        cleanupGraceMinutes: 0,
        orphanGraceHours: MIN_ORPHAN_GRACE_HOURS,
      };
      const sum = async () => {
        const reader = await fixture.openQueryPort();
        try {
          return (await reader.query('SELECT count(*), sum(id) FROM contract_maintained')).rows;
        } finally {
          await reader.close();
        }
      };
      const before = await sum();

      const dry = await admin.maintain(policy, { dryRun: true });
      const dryAgain = await admin.maintain(policy, { dryRun: true });
      const real = await admin.maintain(policy);
      const after = await admin.maintain(policy, { dryRun: true });

      expect(dry).toMatchObject({ dryRun: true, deletedOrphans: 0 });
      expect(dry.expiredSnapshots).toBeGreaterThan(0);
      expect(dry.compactedTables).toBeGreaterThan(0);
      expect(dryAgain).toEqual(dry);
      // What the dry run announced is exactly what the real run does.
      expect({ ...real, dryRun: true }).toEqual(dry);
      expect(real.compactedTables).toBeGreaterThan(0);
      expect(after.expiredSnapshots).toBeLessThan(dry.expiredSnapshots);
      expect(await sum()).toEqual(before);
    });

    it('refuses an orphan grace under the floor, before changing anything', async () => {
      await expect(
        admin.maintain({
          snapshotRetentionDays: 7,
          cleanupGraceMinutes: 60,
          orphanGraceHours: MIN_ORPHAN_GRACE_HOURS - 1,
        }),
      ).rejects.toThrow(RangeError);
    });

    it('rejects several statements or an explicit transaction in one call, running none', async () => {
      await expectLakehouseError(
        admin.execute(
          "INSERT INTO contract_events VALUES (100, 'a'); INSERT INTO contract_events VALUES (101, 'b')",
        ),
        'query_failed',
      );
      await expectLakehouseError(admin.execute('BEGIN TRANSACTION'), 'query_failed');

      const reader = await fixture.openQueryPort();
      try {
        const result = await reader.query(
          'SELECT count(*) FROM contract_events WHERE id IN (100, 101)',
        );
        expect(result.rows).toEqual([['0']]);
      } finally {
        await reader.close();
      }
    });

    it('rejects invalid SQL with query_failed', async () => {
      await expectLakehouseError(admin.execute('CREAT TABLE broken (a INTEGER)'), 'query_failed');
    });

    it('rejects every call after close with engine_closed, and closes idempotently', async () => {
      const closing = await fixture.openAdmin();
      await closing.close();

      await expectLakehouseError(closing.execute('SELECT 1'), 'engine_closed');
      await expectLakehouseError(closing.checkHealth(), 'engine_closed');
      await expect(closing.close()).resolves.toBeUndefined();
    });
  });
}
