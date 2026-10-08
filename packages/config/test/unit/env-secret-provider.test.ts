import { SecretNotFoundError } from '@atlasbi/contracts';
import { describeSecretProviderContract } from '@atlasbi/contracts-testing';
import { describe, expect, it } from 'vitest';

import { EnvSecretProvider, toEnvironmentVariableName } from '../../src/index.ts';

describeSecretProviderContract('EnvSecretProvider', {
  create: (secrets) =>
    new EnvSecretProvider(
      Object.fromEntries(
        Object.entries(secrets).map(([key, value]) => [toEnvironmentVariableName(key), value]),
      ),
    ),
});

describe('EnvSecretProvider', () => {
  it('maps logical keys to ATLASBI_ environment variables', () => {
    expect(toEnvironmentVariableName('database.url')).toBe('ATLASBI_DATABASE_URL');
    expect(toEnvironmentVariableName('cube.api-secret')).toBe('ATLASBI_CUBE_API_SECRET');
  });

  it('tells which variable to set when a secret is missing', async () => {
    const provider = new EnvSecretProvider({});

    const error: unknown = await provider.get('database.url').catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(SecretNotFoundError);
    expect((error as SecretNotFoundError).hint).toBe('set ATLASBI_DATABASE_URL in .env');
  });
});
