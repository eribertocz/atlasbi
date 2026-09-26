import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AnalyticalQueryPort } from '../lakehouse/analytical-query-port.ts';
import {
  LAKEHOUSE_CATALOG_TYPES,
  type LakehouseAdminPort,
} from '../lakehouse/lakehouse-admin-port.ts';
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
