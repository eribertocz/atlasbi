import { randomUUID } from 'node:crypto';

import { LakehouseError } from '@atlasbi/contracts';

import { LAKE_ALIAS } from './attach-statement.ts';
import { PROVISION_REMEDY } from './error-mapper.ts';
import { readRows, scalarText } from './internal-reads.ts';
import type { LakehouseEngine } from './lakehouse-engine.ts';
import { quoteLiteral } from './sql-literals.ts';

const IDENTITY_SCHEMA = 'platform';
const IDENTITY_TABLE = 'lakehouse_identity';

/**
 * Every lakehouse carries a UUID assigned once, at provisioning, stored as one row inside the
 * lakehouse itself. It is what ties other state to *this* lakehouse — SQLMesh keeps one state
 * schema per identity (docs/02 §6.3). Neither alternative works: DuckLake rejects custom options,
 * and the creation time (snapshot 0) disappears once old snapshots expire (docs/01 §6.8).
 * A lakehouse created again — even at the same location — gets a new identity; a copied or
 * relocated one keeps it, because it is the same lakehouse.
 */
export async function readLakehouseIdentity(engine: LakehouseEngine): Promise<string | undefined> {
  const exists = `SELECT count(*) AS n FROM duckdb_tables() WHERE database_name = ${quoteLiteral(LAKE_ALIAS)} AND schema_name = ${quoteLiteral(IDENTITY_SCHEMA)} AND table_name = ${quoteLiteral(IDENTITY_TABLE)}`;
  const tables = await engine.run(exists, (connection) => readRows(connection, exists));
  if (scalarText(tables[0]?.n) !== '1') {
    return undefined;
  }
  const select = `SELECT lakehouse_id FROM ${LAKE_ALIAS}.${IDENTITY_SCHEMA}.${IDENTITY_TABLE}`;
  const rows = await engine.run(select, (connection) => readRows(connection, select));
  if (rows.length !== 1) {
    throw new LakehouseError(
      'catalog_unreachable',
      `The lakehouse identity record must hold exactly one row; it holds ${rows.length}.`,
      { remedy: 'Restore the lakehouse from a backup, or create it again with `pnpm bootstrap`.' },
    );
  }
  return scalarText(rows[0]?.lakehouse_id);
}

/** Health needs the identity; a lakehouse provisioned before identities existed is told to re-provision. */
export async function requireLakehouseIdentity(engine: LakehouseEngine): Promise<string> {
  const identity = await readLakehouseIdentity(engine);
  if (identity === undefined) {
    throw new LakehouseError(
      'catalog_unreachable',
      'This lakehouse has no identity record yet (it was provisioned before build step 2).',
      { remedy: PROVISION_REMEDY },
    );
  }
  return identity;
}

/** Provisioning only: keeps an existing identity, creates one otherwise. */
export async function ensureLakehouseIdentity(
  engine: LakehouseEngine,
): Promise<{ lakehouseId: string; created: boolean }> {
  const existing = await readLakehouseIdentity(engine);
  if (existing !== undefined) {
    return { lakehouseId: existing, created: false };
  }
  const lakehouseId = randomUUID();
  const statements = [
    `CREATE SCHEMA IF NOT EXISTS ${LAKE_ALIAS}.${IDENTITY_SCHEMA}`,
    `CREATE TABLE ${LAKE_ALIAS}.${IDENTITY_SCHEMA}.${IDENTITY_TABLE} (lakehouse_id VARCHAR, created_at TIMESTAMPTZ)`,
    `INSERT INTO ${LAKE_ALIAS}.${IDENTITY_SCHEMA}.${IDENTITY_TABLE} VALUES (${quoteLiteral(lakehouseId)}, now())`,
    // One row stays inlined in the catalog under Inlining v1; flushing this table alone keeps the
    // health's pending-rows count about data, without touching anything else pending.
    `CALL ducklake_flush_inlined_data(${quoteLiteral(LAKE_ALIAS)}, schema_name => ${quoteLiteral(IDENTITY_SCHEMA)}, table_name => ${quoteLiteral(IDENTITY_TABLE)})`,
  ];
  for (const statement of statements) {
    await engine.run(statement, (connection) => connection.run(statement));
  }
  return { lakehouseId, created: true };
}
