import type { DataContract } from '../data/data-contract.ts';
import type { AnalyticalQueryPort } from '../lakehouse/analytical-query-port.ts';
import type { QueryValue } from '../lakehouse/query-result.ts';

/**
 * What a published table does differently from its data contract — empty when it honors it. The
 * producer's tests call it on what they publish (docs/21 §2.4). Types come from the platform's
 * read port, never from an engine's catalog; nullability and grain are checked with the data,
 * because a view (SQLMesh publishes views) reports every column as nullable.
 *
 * `catalog` is the alias the reader attached the lakehouse under (`lake`). Identifiers in a
 * contract are validated lowercase names, so the SQL below needs no quoting.
 */
export async function findDataContractViolations(
  port: AnalyticalQueryPort,
  contract: DataContract,
  options: { catalog: string },
): Promise<string[]> {
  const table = `${options.catalog}.${contract.table.schema}.${contract.table.name}`;
  const violations: string[] = [];

  const shape = await port.query(`SELECT * FROM ${table} LIMIT 0`);
  const published = new Map(shape.columns.map((column) => [column.name, column.type]));
  for (const column of contract.columns) {
    const type = published.get(column.name);
    if (type === undefined) {
      violations.push(`${column.name} is missing`);
    } else if (JSON.stringify(type) !== JSON.stringify(column.type)) {
      violations.push(
        `${column.name} is ${JSON.stringify(type)}, the contract says ${JSON.stringify(column.type)}`,
      );
    }
  }
  for (const name of published.keys()) {
    if (!contract.columns.some((column) => column.name === name)) {
      violations.push(`${name} is published but not in the contract`);
    }
  }

  const required = contract.columns.filter(
    (column) => !column.nullable && published.has(column.name),
  );
  if (required.length > 0) {
    const counts = await port.query(
      `SELECT ${required
        .map((column) => `sum(CASE WHEN ${column.name} IS NULL THEN 1 ELSE 0 END)`)
        .join(', ')} FROM ${table}`,
    );
    required.forEach((column, index) => {
      const nulls = countOf(counts.rows[0]?.[index]);
      if (nulls !== '0') {
        violations.push(`${column.name} has ${nulls} null values; the contract says never`);
      }
    });
  }

  const grain = contract.grain.join(', ');
  const duplicated = await port.query(
    `SELECT count(*) FROM (SELECT ${grain} FROM ${table} GROUP BY ${grain} HAVING count(*) > 1) AS duplicated`,
  );
  const repeated = countOf(duplicated.rows[0]?.[0]);
  if (repeated !== '0') {
    violations.push(`${repeated} values of the grain (${grain}) repeat`);
  }
  return violations;
}

/** A count or a sum as the read port encodes it (a base-10 string); no rows sum to null, i.e. 0. */
function countOf(value: QueryValue | undefined): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '0';
}
