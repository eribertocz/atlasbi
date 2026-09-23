import { sql } from 'kysely';

import { createDatabase } from './create-database.ts';

// SQLSTATEs that waiting cannot fix: wrong credentials, missing authorization, missing database.
const PERMANENT_FAILURE_CODES = new Set(['28P01', '28000', '3D000']);

export class DatabaseUnavailableError extends Error {
  /** False when retrying is pointless (e.g. wrong password), so callers can fail fast. */
  readonly retryable: boolean;

  constructor(reason: string, retryable: boolean) {
    super(`Database is not reachable: ${reason}`);
    this.name = 'DatabaseUnavailableError';
    this.retryable = retryable;
  }
}

/** Round-trips a query, so "the port is open" is never mistaken for "the database is ready". */
export async function checkDatabaseConnection(connectionString: string): Promise<void> {
  const db = createDatabase(connectionString);
  try {
    await sql`select 1`.execute(db);
  } catch (error) {
    throw new DatabaseUnavailableError(
      describeDriverError(error),
      !PERMANENT_FAILURE_CODES.has(driverErrorCode(error) ?? ''),
    );
  } finally {
    await db.destroy();
  }
}

// Driver errors are flattened to text here so no `pg` type crosses this package's boundary.
export function describeDriverError(error: unknown): string {
  const cause = firstCause(error);
  if (cause instanceof Error) {
    const code = driverErrorCode(cause);
    return code !== undefined && !cause.message.includes(code)
      ? `${cause.message} (${code})`
      : cause.message || cause.name;
  }
  return String(cause);
}

export function driverErrorCode(error: unknown): string | undefined {
  const code = (firstCause(error) as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

// Connection failures to "localhost" arrive as an AggregateError (one attempt per address).
function firstCause(error: unknown): unknown {
  return error instanceof AggregateError && error.errors.length > 0
    ? firstCause(error.errors[0])
    : error;
}
