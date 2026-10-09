import { describe, expect, it } from 'vitest';

import { describeFailure, stateSchemaFor } from '../../src/run-sqlmesh.ts';

describe('describeFailure', () => {
  it('reduces a Python traceback to the exception it ends with', () => {
    const traceback = [
      'Traceback (most recent call last):',
      '  File "connection.py", line 462, in init',
      '    cursor.execute(query)',
      '_duckdb.IOException: IO Error: Failed to attach DuckLake MetaData: password authentication failed for user "atlasbi"',
      '',
    ].join('\n');

    expect(describeFailure(traceback)).toBe(
      '_duckdb.IOException: IO Error: Failed to attach DuckLake MetaData: password authentication failed for user "atlasbi"',
    );
  });

  it('picks the exception even when DuckDB adds LINE and caret lines after it (real output)', () => {
    const traceback = [
      'Traceback (most recent call last):',
      '  File "cli.py", line 12, in fetchdf',
      '_duckdb.CatalogException: Catalog Error: Table with name "marts.mart_sales_orders" does not exist because schema "marts" does not exist.',
      '',
      'LINE 1: SELECT count(*) AS n FROM marts.mart_sales_orders',
      '                                  ^',
    ].join('\n');

    expect(describeFailure(traceback)).toBe(
      '_duckdb.CatalogException: Catalog Error: Table with name "marts.mart_sales_orders" does not exist because schema "marts" does not exist.',
    );
  });

  it("keeps SQLMesh's own error line when there is no traceback", () => {
    expect(
      describeFailure('Linter detected issues\nError: Linter detected errors in the code.\n\n'),
    ).toBe('Error: Linter detected errors in the code.');
  });

  it('never repeats a credential', () => {
    expect(describeFailure('Error: cannot reach postgres://atlasbi:s3cret@host/lakehouse')).toBe(
      'Error: cannot reach postgres://atlasbi:***@host/lakehouse',
    );
    expect(describeFailure('Error: host=h password=s3cret')).toBe('Error: host=h password=***');
  });

  it('never repeats the object storage secret SQLMesh put into its CREATE SECRET', () => {
    const traceback = [
      'Traceback (most recent call last):',
      `duckdb.duckdb.InvalidInputException: Invalid Input Error: while running CREATE OR REPLACE SECRET (TYPE s3, KEY_ID 'GKabc', SECRET 'topsecret', SCOPE 's3://lakehouse/data/')`,
    ].join('\n');

    expect(describeFailure(traceback)).not.toContain('topsecret');
    expect(describeFailure("ConfigError: bad secret {'type': 's3', 'secret': 'topsecret'}")).toBe(
      "ConfigError: bad secret {'type': 's3', 'secret': '***'}",
    );
  });
});

describe('stateSchemaFor', () => {
  it('names the SQLMesh state after the lakehouse identity, in the form config.py accepts', () => {
    expect(stateSchemaFor('0F8FAD5B-D9CB-469F-A165-70867728950E')).toBe(
      'sqlmesh_0f8fad5bd9cb469fa16570867728950e',
    );
  });
});
