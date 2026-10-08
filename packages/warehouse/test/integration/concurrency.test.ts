import { LakehouseError } from '@atlasbi/contracts';
import { expectLakehouseError } from '@atlasbi/contracts-testing';
import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';

import { instanceOptions } from '../../src/adapters/duckdb/instance-initializer.ts';
import { createAnalyticalQueryEngine, createLakehouseAdmin } from '../../src/index.ts';
import { createTestLakehouse } from './support/test-lakehouse.ts';

const WRITERS = 8;

describe('PostgreSQL catalog: real concurrent writers', () => {
  it(`lets ${WRITERS} independent writers append to one table at once`, async () => {
    const lakehouse = await createTestLakehouse('postgres');
    try {
      const setup = await createLakehouseAdmin(lakehouse.settings);
      await setup.execute('CREATE TABLE lake.main.events (writer INTEGER, seq BIGINT)');
      await setup.close();

      const writers = await Promise.all(
        Array.from({ length: WRITERS }, () => createLakehouseAdmin(lakehouse.settings)),
      );
      try {
        const results = await Promise.all(
          writers.map((writer, index) =>
            writer.execute(`INSERT INTO lake.main.events SELECT ${index}, range FROM range(1000)`),
          ),
        );
        expect(results).toEqual(Array.from({ length: WRITERS }, () => ({ affectedRows: '1000' })));
      } finally {
        await Promise.all(writers.map((writer) => writer.close()));
      }

      const port = await createAnalyticalQueryEngine(lakehouse.settings);
      try {
        const totals = await port.query(
          'SELECT count(*), count(DISTINCT writer) FROM lake.main.events',
        );
        const snapshots = await port.query(
          "SELECT count(*), max(snapshot_id) - min(snapshot_id) + 1 FROM ducklake_snapshots('lake')",
        );
        expect(totals.rows).toEqual([[String(WRITERS * 1000), String(WRITERS)]]);
        const [count, span] = snapshots.rows[0] ?? [];
        expect(count).toBe(span);
      } finally {
        await port.close();
      }
    } finally {
      await lakehouse.dispose();
    }
  });

  it('reports a logical conflict between two writers as write_conflict, for exactly one of them', async () => {
    const lakehouse = await createTestLakehouse('postgres');
    try {
      const [first, second] = await Promise.all([
        createLakehouseAdmin(lakehouse.settings),
        createLakehouseAdmin(lakehouse.settings),
      ]);
      try {
        const outcomes = await Promise.allSettled([
          first.execute('CREATE TABLE lake.main.duplicate (a INTEGER)'),
          second.execute('CREATE TABLE lake.main.duplicate (a INTEGER)'),
        ]);

        const failures = outcomes.flatMap((outcome) =>
          outcome.status === 'rejected' ? [outcome.reason as unknown] : [],
        );
        expect(failures).toHaveLength(1);
        expect(failures[0]).toBeInstanceOf(LakehouseError);
        expect((failures[0] as LakehouseError).code).toBe('write_conflict');
      } finally {
        await first.close();
        await second.close();
      }
    } finally {
      await lakehouse.dispose();
    }
  });
});

describe('SQLite catalog: a single writing process (docs/01 §6.6)', () => {
  it('serializes concurrent writes inside the process, so none of them fails', async () => {
    const lakehouse = await createTestLakehouse('sqlite');
    try {
      const admin = await createLakehouseAdmin(lakehouse.settings);
      try {
        expect(admin.capabilities.concurrentWriters).toBe(false);
        await admin.execute('CREATE TABLE lake.main.events (writer INTEGER, seq BIGINT)');

        const writerIds = Array.from({ length: WRITERS }, (unused, index) => index);
        const results = await Promise.all(
          writerIds.map((writerId) =>
            admin.execute(
              `INSERT INTO lake.main.events SELECT ${writerId}, range FROM range(1000)`,
            ),
          ),
        );

        expect(results).toEqual(Array.from({ length: WRITERS }, () => ({ affectedRows: '1000' })));
      } finally {
        await admin.close();
      }
      const port = await createAnalyticalQueryEngine(lakehouse.settings);
      try {
        const totals = await port.query('SELECT count(*) FROM lake.main.events');
        expect(totals.rows).toEqual([[String(WRITERS * 1000)]]);
      } finally {
        await port.close();
      }
    } finally {
      await lakehouse.dispose();
    }
  });

  it('gives up on a catalog locked by another writer within its budget, naming the remedy', async () => {
    const lakehouse = await createTestLakehouse('sqlite');
    if (lakehouse.settings.catalog.type !== 'sqlite') {
      throw new Error('expected a SQLite catalog');
    }
    const admin = await createLakehouseAdmin(lakehouse.settings);
    await admin.execute('CREATE TABLE lake.main.events (id BIGINT)');

    // Another writer holds a write transaction on the catalog file, as a second process would.
    const holder = await DuckDBInstance.create(
      ':memory:',
      instanceOptions(lakehouse.settings.extensionDirectory.replaceAll('\\', '/')),
    );
    const holding = await holder.connect();
    try {
      await holding.run('LOAD sqlite');
      await holding.run(
        `ATTACH '${lakehouse.settings.catalog.path.replaceAll('\\', '/')}' AS raw (TYPE sqlite)`,
      );
      await holding.run('BEGIN TRANSACTION');
      await holding.run("UPDATE raw.ducklake_metadata SET value = value WHERE key = 'version'");

      const started = Date.now();
      const error = await expectLakehouseError(
        admin.execute('INSERT INTO lake.main.events VALUES (1)'),
        'catalog_busy',
      );

      expect(error.retryable).toBe(false);
      expect(error.remedy).toContain('restart this process, or use the PostgreSQL catalog');
      expect(Date.now() - started).toBeLessThan(60_000);
    } finally {
      await holding.run('ROLLBACK').catch(() => undefined);
      holding.closeSync();
      holder.closeSync();
      await admin.close();
      await lakehouse.dispose();
    }
  });
});
