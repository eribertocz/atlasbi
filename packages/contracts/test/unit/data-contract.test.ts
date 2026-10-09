import { describe, expect, it } from 'vitest';

import {
  getDataContract,
  InvalidDataContractError,
  LANDING_TECHNICAL_COLUMNS,
  listDataContracts,
  majorVersion,
  parseDataContract,
  UnknownDataContractError,
} from '../../src/index.ts';

const VALID = {
  id: 'mart.example',
  version: '1.0',
  kind: 'mart',
  description: 'An example.',
  table: { schema: 'marts', name: 'mart_example' },
  grain: ['id'],
  columns: [
    { name: 'id', type: { kind: 'int64' }, nullable: false },
    { name: 'amount', type: { kind: 'decimal', precision: 12, scale: 2 }, nullable: true },
  ],
};

function issuesOf(value: unknown): readonly string[] {
  try {
    parseDataContract(value);
  } catch (error) {
    if (error instanceof InvalidDataContractError) {
      return error.issues;
    }
    throw error;
  }
  return [];
}

describe('the data contract files', () => {
  it('are all valid, one per id and major version', () => {
    const keys = listDataContracts().map((contract) => `${contract.id}@${majorVersion(contract)}`);

    expect(keys.sort()).toEqual([
      'landing.github_repo_events@1',
      'mart.github_repo_events@1',
      'mart.sales_orders@1',
      'source.development_sales_orders@1',
    ]);
  });

  it('describe the GitHub activity mart and the landing it is built from', () => {
    const landing = getDataContract('landing.github_repo_events', 1);
    const mart = getDataContract('mart.github_repo_events', 1);

    expect(landing.table).toEqual({ schema: 'landing_github', name: 'repo_events' });
    expect(mart.table).toEqual({ schema: 'marts', name: 'mart_github_repo_events' });
    // The mart publishes the landing's business columns, as the landing promises them; the
    // technical columns of a load stay behind.
    const shape = (columns: typeof mart.columns) =>
      columns.map(({ name, type, nullable }) => ({ name, type, nullable }));
    expect(shape(mart.columns)).toEqual(
      shape(landing.columns.filter((column) => !column.name.startsWith('_'))),
    );
    expect(mart.grain).toEqual(landing.grain);
  });

  it('describe the sales orders mart and the development dataset it is built from', () => {
    const mart = getDataContract('mart.sales_orders', 1);
    const source = getDataContract('source.development_sales_orders', 1);

    expect(mart.table).toEqual({ schema: 'marts', name: 'mart_sales_orders' });
    expect(source.table).toEqual({ schema: 'fixture', name: 'sales_orders' });
    // The mart publishes the source's columns; it promises fewer of them are never null.
    expect(mart.columns.map((column) => [column.name, column.type])).toEqual(
      source.columns.map((column) => [column.name, column.type]),
    );
    expect(mart.columns.filter((column) => !column.nullable).map((column) => column.name)).toEqual([
      'order_id',
      'order_date',
      'region',
      'amount',
    ]);
  });

  it('are looked up by id and major version only', () => {
    expect(() => getDataContract('mart.sales_orders', 2)).toThrow(UnknownDataContractError);
    expect(() => getDataContract('mart.nothing', 1)).toThrow(UnknownDataContractError);
  });
});

describe('parseDataContract', () => {
  it('accepts a well-formed contract as it is', () => {
    expect(parseDataContract(VALID)).toEqual(VALID);
  });

  it("refuses a tool's metadata column in any contract (layer-isolation audit)", () => {
    for (const kind of ['mart', 'source', 'landing']) {
      const issues = issuesOf({
        ...VALID,
        id: `${kind}.example`,
        kind,
        columns: [
          ...VALID.columns,
          ...(kind === 'landing' ? LANDING_TECHNICAL_COLUMNS : []),
          { name: '_dlt_load_id', type: { kind: 'varchar' }, nullable: false },
        ],
      });

      expect(issues, kind).toContain(
        "column _dlt_load_id is a tool's metadata, never part of a contract",
      );
    }
  });

  it('requires the platform technical columns in a landing contract, and only there', () => {
    const landing = { ...VALID, id: 'landing.example', kind: 'landing' };

    expect(
      issuesOf({ ...landing, columns: [...VALID.columns, ...LANDING_TECHNICAL_COLUMNS] }),
    ).toEqual([]);
    expect(issuesOf(landing)).toEqual([
      'a landing contract has _load_id (varchar, not nullable)',
      'a landing contract has _loaded_at (timestamp_tz, not nullable)',
    ]);
    expect(
      issuesOf({
        ...landing,
        columns: [
          ...VALID.columns,
          { ...LANDING_TECHNICAL_COLUMNS[0], nullable: true },
          { ...LANDING_TECHNICAL_COLUMNS[1], type: { kind: 'timestamp' } },
        ],
      }),
    ).toHaveLength(2);
    expect(
      issuesOf({ ...VALID, columns: [...VALID.columns, ...LANDING_TECHNICAL_COLUMNS] }),
    ).toEqual([
      'column _load_id: only the landing technical columns start with "_"',
      'column _loaded_at: only the landing technical columns start with "_"',
    ]);
  });

  it('lists every problem of a malformed contract', () => {
    const issues = issuesOf({
      id: 'source.example',
      version: '0.1',
      kind: 'mart',
      description: ' ',
      table: { schema: 'Marts', name: 'x', catalog: 'lake' },
      grain: ['missing', 'amount'],
      columns: [
        { name: 'amount', type: { kind: 'decimal', precision: 4, scale: 9 }, nullable: true },
        { name: 'amount', type: { kind: 'int64' }, nullable: true },
        { name: 'tags', type: { kind: 'list', element: { kind: 'varchar' } }, nullable: true },
      ],
      owner: 'someone',
    });

    expect(issues).toEqual([
      'the contract has an unknown field "owner"',
      'id must be "<kind>.<name>" in lowercase, starting with "mart."',
      'version must be MAJOR.MINOR, with MAJOR from 1',
      'description must say what the table holds',
      'table must be { schema, name }, both lowercase identifiers',
      'column amount: type must be a scalar LogicalType, e.g. { "kind": "int64" }',
      'column tags: type must be a scalar LogicalType, e.g. { "kind": "int64" }',
      'column amount appears more than once',
      'grain column missing is not a column',
      'grain column amount cannot be nullable',
    ]);
  });

  it('refuses something that is not a contract at all', () => {
    expect(() => parseDataContract([])).toThrow('a data contract is a JSON object');
  });
});
