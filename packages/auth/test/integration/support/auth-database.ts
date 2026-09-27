import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { EnvSecretProvider, SECRET_KEYS } from '@atlasbi/config';
import { migrateToLatest } from '@atlasbi/database';
import { createThrowawayDatabase, type ThrowawayDatabase } from '@atlasbi/database/testing';

const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../../.env', import.meta.url));

/** The local platform database URL from the repo's .env — allowed to create databases. */
export async function developmentAdminUrl(): Promise<string> {
  if (existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  return new EnvSecretProvider().get(SECRET_KEYS.databaseUrl);
}

/** A throwaway platform database with every platform migration applied — `pnpm dev` must run. */
export async function createAuthDatabase(): Promise<ThrowawayDatabase> {
  const database = await createThrowawayDatabase(await developmentAdminUrl());
  try {
    await migrateToLatest({ connectionString: database.connectionString });
    return database;
  } catch (error) {
    await database.drop();
    throw error;
  }
}

/** A secret of its own per test database: nothing is shared with the developer's stack. */
export function testSecret(): string {
  return `test-secret-${crypto.randomUUID()}`;
}
