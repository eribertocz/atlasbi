import type { DuckDBConnection } from '@duckdb/node-api';

/** Rows of an adapter-internal statement (health, options) — never user SQL. */
export async function readRows(
  connection: DuckDBConnection,
  statement: string,
): Promise<Record<string, unknown>[]> {
  const reader = await connection.runAndReadAll(statement);
  return reader.getRowObjectsJson();
}

/** A scalar as text; anything else (null, nested values) as undefined. */
export function scalarText(value: unknown): string | undefined {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'bigint':
    case 'boolean':
      return String(value);
    default:
      return undefined;
  }
}
