import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';

import { LAKE_ALIAS } from './attach-statement.ts';
import { toLakehouseError } from './error-mapper.ts';

/**
 * Per connection: `USE` is the one piece of state a new connection does not inherit (Phase 0, S2),
 * and it still works after the read instance locks its configuration. Platform SQL is fully
 * qualified anyway; `USE` serves SQL written by people (the future SQL Lab).
 */
export async function openLakehouseConnection(instance: DuckDBInstance): Promise<DuckDBConnection> {
  const connection = await instance.connect();
  try {
    await connection.run(`USE ${LAKE_ALIAS}`);
    return connection;
  } catch (error) {
    connection.closeSync();
    throw toLakehouseError(error);
  }
}
