import { LakehouseError } from '@atlasbi/contracts';
import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prepareSingleStatement } from '../../src/adapters/duckdb/statement-guard.ts';
import { createOfflineMemoryInstance } from '../support/offline-memory-instance.ts';

async function rejection(promise: Promise<unknown>): Promise<LakehouseError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(LakehouseError);
  return error as LakehouseError;
}

describe('prepareSingleStatement', () => {
  let instance: DuckDBInstance;
  let connection: DuckDBConnection;

  beforeAll(async () => {
    instance = await createOfflineMemoryInstance();
    connection = await instance.connect();
    await connection.run('CREATE TABLE guarded (id INTEGER)');
  });

  afterAll(() => {
    connection.closeSync();
    instance.closeSync();
  });

  it('prepares a single SELECT for reading, in any of its spellings', async () => {
    for (const sql of [
      'SELECT count(*) FROM guarded',
      'WITH x AS (SELECT 1 AS a) SELECT * FROM x',
      'FROM guarded',
    ]) {
      await expect(prepareSingleStatement(connection, sql, 'read')).resolves.toBeDefined();
    }
  });

  it('refuses everything else for reading — without running it', async () => {
    for (const sql of [
      'INSERT INTO guarded VALUES (1)',
      'DETACH memory',
      'DROP TABLE guarded',
      'SET threads = 1',
      'CREATE TEMP TABLE scratch AS SELECT 1',
      'EXPLAIN SELECT 1',
      'SELECT 1; DELETE FROM guarded',
    ]) {
      const error = await rejection(prepareSingleStatement(connection, sql, 'read'));
      expect(error.code, sql).toBe('read_only_violation');
    }
    const count = await connection.runAndReadAll('SELECT count(*) AS n FROM guarded');
    expect(count.getRowsJson()).toEqual([['0']]);
  });

  it('allows one write statement, but no batches and no explicit transactions', async () => {
    await expect(
      prepareSingleStatement(connection, 'INSERT INTO guarded VALUES (1)', 'write'),
    ).resolves.toBeDefined();

    const batch = await rejection(
      prepareSingleStatement(
        connection,
        'INSERT INTO guarded VALUES (1); INSERT INTO guarded VALUES (2)',
        'write',
      ),
    );
    const transaction = await rejection(
      prepareSingleStatement(connection, 'BEGIN TRANSACTION', 'write'),
    );
    const empty = await rejection(prepareSingleStatement(connection, '  ', 'write'));

    expect(batch.code).toBe('query_failed');
    expect(transaction.code).toBe('query_failed');
    expect(empty.code).toBe('query_failed');
  });
});
