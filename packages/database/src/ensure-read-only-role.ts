import pg from 'pg';

import { DatabaseUnavailableError, describeDriverError, driverErrorCode } from './connection.ts';

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const PERMANENT_FAILURE_CODES = new Set(['28P01', '28000', '3D000', '42501']);
// The maintenance database every PostgreSQL server has.
const MAINTENANCE_DATABASE = 'postgres';

export interface ReadOnlyRoleOptions {
  /** A connection allowed to create roles and grant on the database (development: `database.url`). */
  adminConnectionString: string;
  /** The reader's own URL: its user is the role, its password the role's, its path the database. */
  readerConnectionString: string;
  /** Role that creates the tables later on; its default privileges cover them for the reader. */
  owner: string;
}

/**
 * A role that can read one database and change nothing (docs/01 §6.7): the lakehouse readers —
 * query port, Cube — attach the catalog through it, so even a statement that slips past READ_ONLY
 * cannot touch the catalog. Tables the owner creates later (DuckLake adds them as it goes, e.g.
 * for inlined data) are covered through the owner's default privileges. Idempotent: bootstrap runs
 * it every time, and the password always follows the secret.
 */
export async function ensureReadOnlyRole(
  options: ReadOnlyRoleOptions,
): Promise<'created' | 'existing'> {
  const reader = new URL(options.readerConnectionString);
  const role = decodeURIComponent(reader.username);
  const password = decodeURIComponent(reader.password);
  const database = decodeURIComponent(reader.pathname.replace(/^\//, ''));
  for (const [what, name] of [
    ['Role', role],
    ['Database', database],
    ['Owner role', options.owner],
  ] as const) {
    if (!IDENTIFIER.test(name)) {
      throw new Error(
        `${what} name "${name}" is not a plain lowercase identifier (a-z, 0-9, _), so no read-only role is set up for it.`,
      );
    }
  }
  if (password === '') {
    throw new Error(`The reader URL for role "${role}" has no password.`);
  }

  // A role belongs to the whole server, while advisory locks belong to one database: the role is
  // created or updated from the maintenance database, where every caller meets the same lock —
  // two bootstraps, or suites running in parallel, would otherwise race on it ("tuple concurrently
  // updated"). The grants then go to the reader's own database, where they live.
  const outcome = await inTransaction(
    options.adminConnectionString,
    MAINTENANCE_DATABASE,
    `read-only-role:${role}`,
    async (run, client) => {
      const existing = await client.query('select 1 from pg_roles where rolname = $1', [role]);
      const found = existing.rowCount !== null && existing.rowCount > 0;
      await (found
        ? run('alter role %I with login password %L', role, password)
        : run(
            'create role %I login password %L nosuperuser nocreatedb nocreaterole noinherit',
            role,
            password,
          ));
      return found ? 'existing' : 'created';
    },
  );
  await inTransaction(
    options.adminConnectionString,
    database,
    `read-only-grants:${role}`,
    async (run) => {
      await run('grant connect on database %I to %I', database, role);
      await run('grant usage on schema public to %I', role);
      await run('grant select on all tables in schema public to %I', role);
      await run(
        'alter default privileges for role %I in schema public grant select on tables to %I',
        options.owner,
        role,
      );
    },
  );
  return outcome;
}

type RunStatement = (template: string, ...values: string[]) => Promise<void>;

/** One transaction on `database`, serialized with every other holder of `lockName` there. */
async function inTransaction<T>(
  adminConnectionString: string,
  database: string,
  lockName: string,
  work: (run: RunStatement, client: pg.Client) => Promise<T>,
): Promise<T> {
  const url = new URL(adminConnectionString);
  url.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: url.toString() });
  // format() quotes identifiers (%I) and literals such as the password (%L) inside Postgres itself.
  const run: RunStatement = async (template, ...values) => {
    const placeholders = Array.from(values, (value, index) => `$${index + 2}::text`).join(', ');
    const { rows } = await client.query<{ statement: string }>(
      `select format($1::text, ${placeholders}) as statement`,
      [template, ...values],
    );
    await client.query(rows[0]?.statement ?? '');
  };
  try {
    await client.connect();
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [lockName]);
    const result = await work(run, client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw new DatabaseUnavailableError(
      describeDriverError(error),
      !PERMANENT_FAILURE_CODES.has(driverErrorCode(error) ?? ''),
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
