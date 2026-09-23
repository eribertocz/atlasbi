import { describe, expect, it } from 'vitest';

import { retryUntil } from '../../src/health/retry-until.ts';

describe('retryUntil', () => {
  it('retries transient failures until the attempt succeeds', async () => {
    let attempts = 0;
    const result = await retryUntil(
      () => (++attempts < 3 ? Promise.reject(new Error('not yet')) : Promise.resolve('ready')),
      { timeoutMs: 1_000, intervalMs: 1 },
    );

    expect(result).toBe('ready');
    expect(attempts).toBe(3);
  });

  it('rethrows at once a failure that waiting cannot fix', async () => {
    let attempts = 0;
    const permanent = new Error('password authentication failed');

    await expect(
      retryUntil(
        () => {
          attempts++;
          return Promise.reject(permanent);
        },
        { timeoutMs: 10_000, intervalMs: 1, isRetryable: (error) => error !== permanent },
      ),
    ).rejects.toBe(permanent);
    expect(attempts).toBe(1);
  });
});
