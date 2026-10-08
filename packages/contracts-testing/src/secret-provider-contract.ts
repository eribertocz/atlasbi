import { describe, expect, it } from 'vitest';

import { SecretNotFoundError, type SecretProvider } from '@atlasbi/contracts';

export interface SecretProviderFixture {
  /** Builds a provider holding exactly `secrets`, keyed by logical secret key. */
  create(secrets: Readonly<Record<string, string>>): SecretProvider | Promise<SecretProvider>;
}

/**
 * The battery every SecretProvider adapter must pass (docs/21 §3.3): an adapter that fails
 * any of these cannot replace another one.
 */
export function describeSecretProviderContract(
  adapterName: string,
  fixture: SecretProviderFixture,
): void {
  describe(`SecretProvider contract: ${adapterName}`, () => {
    it('resolves a stored secret by its logical key', async () => {
      const provider = await fixture.create({ 'database.url': 'postgres://contract-test' });

      await expect(provider.get('database.url')).resolves.toBe('postgres://contract-test');
    });

    it('rejects a missing secret with SecretNotFoundError carrying the key', async () => {
      const provider = await fixture.create({});

      const error: unknown = await provider.get('database.url').catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(SecretNotFoundError);
      expect((error as SecretNotFoundError).key).toBe('database.url');
    });

    it('treats an empty value as missing instead of returning it', async () => {
      const provider = await fixture.create({ 'database.url': '' });

      await expect(provider.get('database.url')).rejects.toBeInstanceOf(SecretNotFoundError);
    });

    it('never includes another secret value in a not-found error', async () => {
      const provider = await fixture.create({ 'other.secret': 'do-not-leak' });

      const error: unknown = await provider.get('database.url').catch((reason: unknown) => reason);

      expect(String((error as Error).message)).not.toContain('do-not-leak');
    });
  });
}
