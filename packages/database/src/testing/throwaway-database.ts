import { randomUUID } from 'node:crypto';

import pg from 'pg';

export interface ThrowawayDatabase {
  connectionString: string;
  drop(): Promise<void>;
}

/**
 * An isolated database on the local Postgres (`pnpm dev` must be running), so integration tests
 * never touch a real platform or lakehouse database. `adminConnectionString` must be allowed to
 * create databases — in development, the `database.url` secret.
 */
export async function createThrowawayDatabase(
  adminConnectionString: string,
): Promise<ThrowawayDatabase> {
  const name = `atlasbi_test_${randomUUID().replaceAll('-', '')}`;

  await runAsAdmin(adminConnectionString, `create database ${name}`);

  const url = new URL(adminConnectionString);
  url.pathname = `/${name}`;
  return {
    connectionString: url.toString(),
    drop: () => runAsAdmin(adminConnectionString, `drop database if exists ${name} with (force)`),
  };
}

async function runAsAdmin(connectionString: string, statement: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}
