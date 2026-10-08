import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_QUERY_MAX_ROWS, type AnalyticalQueryPort } from '@atlasbi/contracts';
import { LakehouseError, type LakehouseErrorCode } from '@atlasbi/contracts';
import type { LogicalType, QueryValue } from '@atlasbi/contracts';

export interface AnalyticalQueryPortFixture {
  /** Runs these statements with write access against the lakehouse the ports will read. */
  setup(statements: readonly string[]): Promise<void>;
  /** A new read-only port over that lakehouse; the battery closes it. */
  openPort(): Promise<AnalyticalQueryPort>;
  /** Releases whatever the fixture created. */
  dispose(): Promise<void>;
}

const SETUP = [
  'CREATE TABLE contract_orders (order_id BIGINT, amount DECIMAL(12,2), placed_at TIMESTAMP, note VARCHAR)',
  "INSERT INTO contract_orders SELECT range, (range * 1.25)::DECIMAL(12,2), TIMESTAMP '2026-01-01 00:00:00' + to_hours(range), 'n' || range FROM range(1, 51)",
];

/** SQL expression → exact encoded value (docs/01 §7) → platform type, where the type is the point. */
const ENCODING_CASES: readonly (readonly [string, QueryValue, LogicalType?])[] = [
  ['true', true, { kind: 'boolean' }],
  ['127::TINYINT', 127, { kind: 'int8' }],
  ['2147483647::INTEGER', 2147483647, { kind: 'int32' }],
  ['4294967295::UINTEGER', 4294967295, { kind: 'uint32' }],
  ['9007199254740993::BIGINT', '9007199254740993', { kind: 'int64' }],
  ['42::BIGINT', '42', { kind: 'int64' }],
  ['18446744073709551615::UBIGINT', '18446744073709551615', { kind: 'uint64' }],
  [
    '170141183460469231731687303715884105727::HUGEINT',
    '170141183460469231731687303715884105727',
    { kind: 'int128' },
  ],
  ['1234.50::DECIMAL(10,2)', '1234.50', { kind: 'decimal', precision: 10, scale: 2 }],
  [
    '-0.00012345678901234567890::DECIMAL(38,24)',
    '-0.000123456789012345678900',
    { kind: 'decimal', precision: 38, scale: 24 },
  ],
  ['1.5::DOUBLE', 1.5, { kind: 'float64' }],
  ["'NaN'::DOUBLE", 'NaN'],
  ["'Infinity'::DOUBLE", 'Infinity'],
  ["'-Infinity'::DOUBLE", '-Infinity'],
  ["DATE '2026-09-23'", '2026-09-23', { kind: 'date' }],
  ["TIME '12:34:56.123456'", '12:34:56.123456', { kind: 'time' }],
  ["TIMESTAMP '2026-09-23 12:34:56.123456'", '2026-09-23T12:34:56.123456', { kind: 'timestamp' }],
  [
    "TIMESTAMPTZ '2026-09-23 12:34:56.123456-04'",
    '2026-09-23T16:34:56.123456Z',
    { kind: 'timestamp_tz' },
  ],
  [
    "INTERVAL '1 year 2 months 3 days 04:05:06.789'",
    { months: 14, days: 3, micros: '14706789000' },
    { kind: 'interval' },
  ],
  [
    "'b1f3c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'::UUID",
    'b1f3c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    { kind: 'uuid' },
  ],
  ["'\\xAA\\xBB'::BLOB", 'qrs=', { kind: 'blob' }],
  ["'texto con ñ'", 'texto con ñ', { kind: 'varchar' }],
  [
    '[1, 9007199254740993]::BIGINT[]',
    ['1', '9007199254740993'],
    { kind: 'list', element: { kind: 'int64' } },
  ],
  ["[TIMESTAMP '2026-01-01 00:00:00']", ['2026-01-01T00:00:00']],
  [
    "{'id': 9007199254740993::BIGINT, 'amount': 10.10::DECIMAL(5,2)}",
    { id: '9007199254740993', amount: '10.10' },
    {
      kind: 'struct',
      fields: [
        { name: 'id', type: { kind: 'int64' } },
        { name: 'amount', type: { kind: 'decimal', precision: 5, scale: 2 } },
      ],
    },
  ],
  [
    "MAP {'k': 9007199254740993::BIGINT}",
    [{ key: 'k', value: '9007199254740993' }],
    { kind: 'map', key: { kind: 'varchar' }, value: { kind: 'int64' } },
  ],
  ['NULL::BIGINT', null, { kind: 'int64' }],
];

/**
 * The battery every AnalyticalQueryPort adapter must pass (docs/21 §3.3), including the lossless
 * value encoding the port promises (docs/01 §7).
 */
export function describeAnalyticalQueryPortContract(
  adapterName: string,
  fixture: AnalyticalQueryPortFixture,
): void {
  describe(`AnalyticalQueryPort contract: ${adapterName}`, () => {
    let port: AnalyticalQueryPort;

    beforeAll(async () => {
      await fixture.setup(SETUP);
      port = await fixture.openPort();
    });

    afterAll(async () => {
      await port.close();
      await fixture.dispose();
    });

    it('returns platform logical types and positional rows', async () => {
      const result = await port.query(
        'SELECT order_id, amount, placed_at, note FROM contract_orders ORDER BY order_id LIMIT 2',
      );

      expect(result.columns).toEqual([
        { name: 'order_id', type: { kind: 'int64' } },
        { name: 'amount', type: { kind: 'decimal', precision: 12, scale: 2 } },
        { name: 'placed_at', type: { kind: 'timestamp' } },
        { name: 'note', type: { kind: 'varchar' } },
      ]);
      expect(result.rows).toEqual([
        ['1', '1.25', '2026-01-01T01:00:00', 'n1'],
        ['2', '2.50', '2026-01-01T02:00:00', 'n2'],
      ]);
      expect(result).toMatchObject({ rowCount: 2, truncated: false });
    });

    it('encodes every value losslessly', async () => {
      const result = await port.query(
        `SELECT ${ENCODING_CASES.map(([expression], index) => `${expression} AS c${index}`).join(', ')}`,
      );

      expect(result.rows).toEqual([ENCODING_CASES.map(([, value]) => value)]);
      result.columns.forEach((column, index) => {
        const [expression, , type] = ENCODING_CASES[index] ?? [];
        if (type !== undefined) {
          expect(column.type, expression).toEqual(type);
        }
      });
    });

    it('binds positional parameters, with bigint and decimal passed as strings', async () => {
      const result = await port.query(
        'SELECT $1::BIGINT + 1 AS next_id, $2::DECIMAL(38,9) * 2 AS doubled, $3::VARCHAR AS label, $4::INTEGER IS NULL AS missing, $5::DOUBLE AS ratio',
        ['9007199254740993', '12345678901234567890123456789.123456789', 'x', null, 0.5],
      );

      expect(result.rows).toEqual([
        ['9007199254740994', '24691357802469135780246913578.246913578', 'x', true, 0.5],
      ]);
    });

    it('stops reading at maxRows and reports truncation', async () => {
      const ordered = 'SELECT order_id FROM contract_orders ORDER BY order_id';

      const truncated = await port.query(ordered, [], { maxRows: 10 });
      const complete = await port.query(ordered, [], { maxRows: 50 });
      const byDefault = await port.query(`SELECT range FROM range(${DEFAULT_QUERY_MAX_ROWS + 1})`);

      expect(truncated).toMatchObject({ rowCount: 10, truncated: true });
      expect(truncated.rows.at(-1)).toEqual(['10']);
      expect(complete).toMatchObject({ rowCount: 50, truncated: false });
      expect(byDefault).toMatchObject({ rowCount: DEFAULT_QUERY_MAX_ROWS, truncated: true });
    });

    it('rejects anything but a single SELECT, without running it', async () => {
      const statements = [
        'INSERT INTO contract_orders VALUES (999, 1, NULL, NULL)',
        'UPDATE contract_orders SET note = NULL',
        'DELETE FROM contract_orders',
        'CREATE TABLE contract_intruder (a INTEGER)',
        'DROP TABLE contract_orders',
        'SELECT 1; SELECT 2',
        'SELECT 1; DROP TABLE contract_orders',
        'BEGIN TRANSACTION',
      ];

      for (const statement of statements) {
        await expectLakehouseError(port.query(statement), 'read_only_violation', statement);
      }
      const count = await port.query('SELECT count(*) AS n FROM contract_orders');
      expect(count.rows).toEqual([['50']]);
    });

    it('rejects invalid SQL with query_failed, not retryable', async () => {
      const syntax = await expectLakehouseError(port.query('SELEC 1'), 'query_failed');
      const missing = await expectLakehouseError(
        port.query('SELECT * FROM contract_missing'),
        'query_failed',
      );

      expect(syntax.retryable).toBe(false);
      expect(missing.retryable).toBe(false);
    });

    it('cancels a statement that exceeds timeoutMs, as a retryable query_failed', async () => {
      const started = Date.now();

      const timeout = await expectLakehouseError(
        port.query('SELECT sum(range % 7) FROM range(50000000000)', [], { timeoutMs: 100 }),
        'query_failed',
      );
      expect(timeout.retryable).toBe(true);
      expect(Date.now() - started).toBeLessThan(10_000);
      await expect(port.query('SELECT 1 AS still_usable')).resolves.toMatchObject({ rowCount: 1 });
    });

    it('rejects every call after close with engine_closed, and closes idempotently', async () => {
      const closing = await fixture.openPort();
      await closing.close();

      await expectLakehouseError(closing.query('SELECT 1'), 'engine_closed');
      await expect(closing.close()).resolves.toBeUndefined();
    });
  });
}

export async function expectLakehouseError(
  operation: Promise<unknown>,
  code: LakehouseErrorCode,
  context?: string,
): Promise<LakehouseError> {
  const error: unknown = await operation.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error, context).toBeInstanceOf(LakehouseError);
  expect((error as LakehouseError).code, context).toBe(code);
  return error as LakehouseError;
}
