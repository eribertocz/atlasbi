import type { DataContract, DataContractType, LakehouseAdminPort } from '@atlasbi/contracts';

/** A value of a fixture row, as SQL text: it is cast to the column's type. */
export type ContractRowValue = string | number | null;

/** How the lakehouse's SQL spells a contract type — the contract itself never says it. */
export function lakehouseSqlType(type: DataContractType): string {
  switch (type.kind) {
    case 'decimal':
      return `DECIMAL(${type.precision}, ${type.scale})`;
    case 'timestamp_tz':
      return 'TIMESTAMPTZ';
    case 'int8':
      return 'TINYINT';
    case 'int16':
      return 'SMALLINT';
    case 'int32':
      return 'INTEGER';
    case 'int64':
      return 'BIGINT';
    case 'int128':
      return 'HUGEINT';
    case 'uint8':
      return 'UTINYINT';
    case 'uint16':
      return 'USMALLINT';
    case 'uint32':
      return 'UINTEGER';
    case 'uint64':
      return 'UBIGINT';
    case 'uint128':
      return 'UHUGEINT';
    case 'float32':
      return 'FLOAT';
    case 'float64':
      return 'DOUBLE';
    default:
      return type.kind.toUpperCase();
  }
}

/**
 * A table exactly as a data contract describes it (docs/21 §2.4), for a consumer's tests: a view
 * of the given rows with the contract's columns and types, in its schema and under its name —
 * never what the producer writes behind it. Every row has exactly the contract's columns.
 */
export async function writeContractView(
  admin: LakehouseAdminPort,
  contract: DataContract,
  rows: readonly Record<string, ContractRowValue>[],
): Promise<void> {
  const names = contract.columns.map((column) => column.name).sort();
  for (const row of rows) {
    if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(names)) {
      throw new Error(`A ${contract.id} fixture row must have exactly the contract's columns.`);
    }
  }
  const literal = (value: ContractRowValue | undefined) =>
    value === null || value === undefined
      ? 'NULL'
      : typeof value === 'number'
        ? String(value)
        : `'${value.replaceAll("'", "''")}'`;
  const select = (row: Record<string, ContractRowValue> | undefined) =>
    contract.columns
      .map(
        (column) =>
          `CAST(${literal(row?.[column.name])} AS ${lakehouseSqlType(column.type)}) AS ${column.name}`,
      )
      .join(', ');
  const body =
    rows.length === 0
      ? `SELECT ${select(undefined)} WHERE false`
      : rows.map((row) => `SELECT ${select(row)}`).join('\nUNION ALL\n');
  const { schema, name } = contract.table;
  await admin.execute(`CREATE SCHEMA IF NOT EXISTS lake.${schema}`);
  await admin.execute(`CREATE OR REPLACE VIEW lake.${schema}.${name} AS\n${body}`);
}
