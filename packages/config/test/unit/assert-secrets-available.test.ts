import { describe, expect, it } from 'vitest';

import { assertSecretsAvailable, ConfigurationError, EnvSecretProvider } from '../../src/index.ts';

describe('assertSecretsAvailable', () => {
  it('passes when every key resolves', async () => {
    const provider = new EnvSecretProvider({ ATLASBI_DATABASE_URL: 'postgres://ok' });

    await expect(assertSecretsAvailable(provider, ['database.url'])).resolves.toBeUndefined();
  });

  it('lists every missing secret with the variable to set', async () => {
    const provider = new EnvSecretProvider({});

    const error: unknown = await assertSecretsAvailable(provider, [
      'database.url',
      'cube.api-secret',
    ]).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as ConfigurationError).issues).toEqual([
      'Secret "database.url" is not available: set ATLASBI_DATABASE_URL in .env.',
      'Secret "cube.api-secret" is not available: set ATLASBI_CUBE_API_SECRET in .env.',
    ]);
  });
});
