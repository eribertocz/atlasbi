import { describe, expect, it } from 'vitest';

import {
  type AnalyticalQueryPort,
  parseDataContract,
  type QueryColumn,
  type QueryResult,
} from '@atlasbi/contracts';

import { findDataContractViolations } from '../../src/index.ts';

const CONTRACT = parseDataContract({
  id: 'mart.example',
  version: '1.0',
  kind: 'mart',
  description: 'An example.',
  table: { schema: 'marts', name: 'mart_example' },
  grain: ['id'],
  columns: [
    { name: 'id', type: { kind: 'int64' }, nullable: false },
    { name: 'region', type: { kind: 'varchar' }, nullable: false },
    { name: 'amount', type: { kind: 'decimal', precision: 12, scale: 2 }, nullable: true },
  ],
});

/** A read port over a table that publishes `columns`, with these null counts and repeated grains. */
function publishing(
  columns: QueryColumn[],
  facts: { nulls: string[]; repeated: string },
): AnalyticalQueryPort & { sql: string[] } {
  const sql: string[] = [];
  const result = (rows: QueryResult['rows'], resultColumns: QueryColumn[] = []): QueryResult => ({
    columns: resultColumns,
    rows,
    rowCount: rows.length,
    truncated: false,
  });
  return {
    sql,
    capabilities: {} as AnalyticalQueryPort['capabilities'],
    query(statement: string) {
      sql.push(statement);
      if (statement.endsWith('LIMIT 0')) {
        return Promise.resolve(result([], columns));
      }
      if (statement.includes('IS NULL')) {
        return Promise.resolve(result([facts.nulls]));
      }
      return Promise.resolve(result([[facts.repeated]]));
    },
    close: () => Promise.resolve(),
  };
}

describe('findDataContractViolations', () => {
  it('finds nothing when the published table honors the contract', async () => {
    const port = publishing(
      CONTRACT.columns.map((column) => ({ name: column.name, type: column.type })),
      { nulls: ['0', '0'], repeated: '0' },
    );

    await expect(findDataContractViolations(port, CONTRACT, { catalog: 'lake' })).resolves.toEqual(
      [],
    );
    expect(port.sql[0]).toBe('SELECT * FROM lake.marts.mart_example LIMIT 0');
  });

  it('names every difference: a missing or extra column, another type, nulls, a repeated grain', async () => {
    const port = publishing(
      [
        { name: 'id', type: { kind: 'int32' } },
        { name: 'region', type: { kind: 'varchar' } },
        { name: '_tool_load_id', type: { kind: 'varchar' } },
      ],
      { nulls: ['0', '3'], repeated: '2' },
    );

    await expect(findDataContractViolations(port, CONTRACT, { catalog: 'lake' })).resolves.toEqual([
      'id is {"kind":"int32"}, the contract says {"kind":"int64"}',
      'amount is missing',
      '_tool_load_id is published but not in the contract',
      'region has 3 null values; the contract says never',
      '2 values of the grain (id) repeat',
    ]);
  });
});
