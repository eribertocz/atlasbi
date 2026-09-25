import pg from 'pg';

import { DatabaseUnavailableError, describeDriverError, driverErrorCode } from './connection.ts';

const DATABASE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
// The maintenance database every PostgreSQL server has; CREATE DATABASE cannot target itself.
const MAINTENANCE_DATABASE = 'postgres';
const PERMANENT_FAILURE_CODES = new Set(['28P01', '28000', '3D000', '42501']);

/**
 * Creates the database named in `connectionString` if it does not exist yet — with the same
 * server and credentials, through the maintenance database. Idempotent: bootstrap runs it on
 * every call (docs/19 §3). The name must be a plain lowercase identifier; nothing is quoted around.
 */
export async function ensureDatabaseExists(
  connectionString: string,
): Promise<'created' | 'existing'> {
  const url = new URL(connectionString);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!DATABASE_NAME.test(name)) {
    throw new Error(
      `Database name "${name}" is not a plain lowercase identifier (a-z, 0-9, _), so it is not created automatically.`,
    );
  }
  url.pathname = `/${MAINTENANCE_DATABASE}`;

  const client = new pg.Client({ connectionString: url.toString() });
  try {
    await client.connect();
    const existing = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (existing.rowCount !== null && existing.rowCount > 0) {
      return 'existing';
    }
    await client.query(`create database ${name}`);
    return 'created';
  } catch (error) {
    // Another process created it between the check and the create — the outcome is the same.
    if (driverErrorCode(error) === '42P04') {
      return 'existing';
    }
    throw new DatabaseUnavailableError(
      describeDriverError(error),
      !PERMANENT_FAILURE_CODES.has(driverErrorCode(error) ?? ''),
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
