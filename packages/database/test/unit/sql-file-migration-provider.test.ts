import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SqlFileMigrationProvider } from '../../src/migrations/sql-file-migration-provider.ts';

describe('SqlFileMigrationProvider', () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'atlasbi-migrations-'));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('returns migrations keyed by file name, in lexical order, ignoring non-SQL files', async () => {
    await writeFile(path.join(folder, '000002_second.sql'), 'select 2;');
    await writeFile(path.join(folder, '000001_first.sql'), 'select 1;');
    await writeFile(path.join(folder, 'README.md'), '# notes');

    const migrations = await new SqlFileMigrationProvider(folder).getMigrations();

    expect(Object.keys(migrations)).toEqual(['000001_first', '000002_second']);
  });

  it('rejects files that do not follow the 000001_description.sql convention', async () => {
    await writeFile(path.join(folder, '1_Initial.sql'), 'select 1;');

    await expect(new SqlFileMigrationProvider(folder).getMigrations()).rejects.toThrow(
      '1_Initial.sql',
    );
  });
});
