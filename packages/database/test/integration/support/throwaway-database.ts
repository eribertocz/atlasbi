import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { EnvSecretProvider, SECRET_KEYS } from '@atlasbi/config';
import pg from 'pg';

const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../../.env', import.meta.url));

export interface ThrowawayDatabase {
  connectionString: string;
  drop(): Promise<void>;
}

/**
 * Creates an isolated database on the local Postgres (`pnpm dev` must be running) so
 * integration tests never touch the real platform schema.
 */
export async function createThrowawayDatabase(): Promise<ThrowawayDatabase> {
  if (existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  const adminConnectionString = await new EnvSecretProvider().get(SECRET_KEYS.databaseUrl);
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
