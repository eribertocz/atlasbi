import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { toQueryResult } from '../../src/adapters/duckdb/value-encoding.ts';
import { createOfflineMemoryInstance } from '../support/offline-memory-instance.ts';

// An offline in-memory DuckDB, no extensions: the encoding is a pure function of engine values.
describe('lossless value encoding', () => {
  let instance: DuckDBInstance;
  let connection: DuckDBConnection;

  beforeAll(async () => {
    instance = await createOfflineMemoryInstance();
    connection = await instance.connect();
  });

  afterAll(() => {
    connection.closeSync();
    instance.closeSync();
  });

  async function encode(sql: string, maxRows = 100) {
    return toQueryResult(await connection.streamAndReadUntil(sql, maxRows + 1), maxRows);
  }

  it('renders TIMESTAMPTZ from the instant in UTC, whatever the session time zone', async () => {
    await connection.run("SET TimeZone = 'America/Santiago'");
    try {
      const result = await encode(
        "SELECT TIMESTAMPTZ '2026-09-23 12:34:56.123456+00' AS utc, TIMESTAMPTZ '2026-01-01 00:00:00-03' AS offset_input",
      );
      expect(result.rows).toEqual([['2026-09-23T12:34:56.123456Z', '2026-01-01T03:00:00Z']]);
    } finally {
      await connection.run("SET TimeZone = 'UTC'");
    }
  });

  it('never attaches a zone to a TIMESTAMP, at any precision', async () => {
    const result = await encode(`SELECT
      TIMESTAMP '2026-09-23 12:34:56' AS whole_seconds,
      TIMESTAMP_S '2026-09-23 12:34:56' AS seconds,
      TIMESTAMP_MS '2026-09-23 12:34:56.123' AS millis,
      TIMESTAMP_NS '2026-09-23 12:34:56.123456789' AS nanos`);

    expect(result.rows).toEqual([
      [
        '2026-09-23T12:34:56',
        '2026-09-23T12:34:56',
        '2026-09-23T12:34:56.123',
        '2026-09-23T12:34:56.123456789',
      ],
    ]);
    expect(result.columns.map((column) => column.type)).toEqual(
      Array.from({ length: 4 }, () => ({ kind: 'timestamp' })),
    );
  });

  it('passes infinite timestamps through unchanged', async () => {
    const result = await encode(
      "SELECT 'infinity'::TIMESTAMP AS forever, '-infinity'::TIMESTAMPTZ AS never",
    );

    expect(result.rows).toEqual([['infinity', '-infinity']]);
  });

  it('encodes blobs as base64, also inside nested values', async () => {
    const result = await encode(
      "SELECT '\\x00\\xFF'::BLOB AS raw, [ '\\xAA\\xBB'::BLOB ] AS listed, {'payload': '\\x01'::BLOB} AS nested",
    );

    expect(result.rows).toEqual([['AP8=', ['qrs='], { payload: 'AQ==' }]]);
  });

  it('reports types without a platform encoding as `other`, valued as strings', async () => {
    const result = await encode("SELECT TIMETZ '12:34:56+02' AS with_zone, '101'::BIT AS bits");

    expect(result.columns).toEqual([
      { name: 'with_zone', type: { kind: 'other', name: 'TIME WITH TIME ZONE' } },
      { name: 'bits', type: { kind: 'other', name: 'BIT' } },
    ]);
    expect(result.rows).toEqual([['12:34:56+02', '101']]);
  });

  it('keeps duplicate column names, positionally', async () => {
    const result = await encode('SELECT 1 AS a, 2 AS a');

    expect(result.columns.map((column) => column.name)).toEqual(['a', 'a']);
    expect(result.rows).toEqual([[1, 2]]);
  });

  it('truncates at maxRows and says so', async () => {
    const result = await encode('SELECT range FROM range(5000)', 3000);

    expect(result).toMatchObject({ rowCount: 3000, truncated: true });
    expect(result.rows.at(-1)).toEqual(['2999']);
  });
});
