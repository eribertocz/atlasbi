import { SECRET_KEYS } from '@atlasbi/config';
import { SecretNotFoundError, type SecretProvider } from '@atlasbi/contracts';
import { describe, expect, it } from 'vitest';

import { createSemanticRuntime } from '../../src/index.ts';

function recordingSecrets(values: Record<string, string>): SecretProvider & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    get(key) {
      asked.push(key);
      const value = values[key];
      return value === undefined
        ? Promise.reject(new SecretNotFoundError(key))
        : Promise.resolve(value);
    },
  };
}

const URL = 'http://127.0.0.1:4000';

// The composition root asks for "the semantic runtime of this deployment": which engine, and
// whether there is one, is decided here (layer-isolation audit, 2026-10-04).
describe('createSemanticRuntime', () => {
  it('gives no runtime where the semantic layer does not run, without asking for its secret', async () => {
    const secrets = recordingSecrets({});

    await expect(
      createSemanticRuntime({ config: { semantic: { enabled: false, url: URL } }, secrets }),
    ).resolves.toBeUndefined();
    expect(secrets.asked).toEqual([]);
  });

  it('builds the port with the secret it needs, without calling the engine yet', async () => {
    const secrets = recordingSecrets({ [SECRET_KEYS.semanticApiSecret]: 'x'.repeat(40) });

    const runtime = await createSemanticRuntime({
      config: { semantic: { enabled: true, url: URL } },
      secrets,
    });

    expect(secrets.asked).toEqual([SECRET_KEYS.semanticApiSecret]);
    expect(typeof runtime?.query).toBe('function');
    expect(typeof runtime?.describe).toBe('function');
    expect(runtime?.capabilities).toMatchObject({ semanticSql: false });
  });

  it('fails fast when the secret is missing', async () => {
    await expect(
      createSemanticRuntime({
        config: { semantic: { enabled: true, url: URL } },
        secrets: recordingSecrets({}),
      }),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
  });
});
