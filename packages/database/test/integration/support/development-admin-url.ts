import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { EnvSecretProvider, SECRET_KEYS } from '@atlasbi/config';

const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../../.env', import.meta.url));

/** The local platform database URL from the repo's .env — allowed to create databases. */
export async function developmentAdminUrl(): Promise<string> {
  if (existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  return new EnvSecretProvider().get(SECRET_KEYS.databaseUrl);
}
