import { SecretNotFoundError, type SecretProvider } from '@atlasbi/contracts';

import type { EnvironmentVariables } from '../load-config.ts';

const VARIABLE_PREFIX = 'ATLASBI_';

/** Development/portable SecretProvider adapter: `database.url` → `ATLASBI_DATABASE_URL`. */
export class EnvSecretProvider implements SecretProvider {
  readonly #env: EnvironmentVariables;

  constructor(env: EnvironmentVariables = process.env) {
    this.#env = env;
  }

  get(key: string): Promise<string> {
    const variableName = toEnvironmentVariableName(key);
    const value = this.#env[variableName];
    if (value === undefined || value === '') {
      return Promise.reject(new SecretNotFoundError(key, `set ${variableName} in .env`));
    }
    return Promise.resolve(value);
  }
}

export function toEnvironmentVariableName(key: string): string {
  return VARIABLE_PREFIX + key.replace(/[.-]/g, '_').toUpperCase();
}
