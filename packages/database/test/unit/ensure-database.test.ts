import { describe, expect, it } from 'vitest';

import { ensureDatabaseExists } from '../../src/index.ts';

describe('ensureDatabaseExists', () => {
  it('refuses names that would need quoting, before connecting anywhere', async () => {
    await expect(
      ensureDatabaseExists('postgres://user:secret@127.0.0.1:1/Lake-House'),
    ).rejects.toThrow('is not a plain lowercase identifier');
    await expect(
      ensureDatabaseExists('postgres://user:secret@127.0.0.1:1/lake;drop'),
    ).rejects.toThrow('is not a plain lowercase identifier');
  });
});
