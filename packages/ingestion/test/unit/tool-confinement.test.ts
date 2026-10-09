import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PACKAGE = 'packages/ingestion/';

/**
 * The only files outside this package that name its tool, on purpose (decision D2, docs/21 §2.4):
 * two guards that exist to stop the tool's metadata — the data contract parser and the SQLMesh
 * lint rule — and their tests. Changing the tool means updating both guards and this list.
 */
const KNOWN_EXCEPTIONS = [
  'packages/contracts/src/data/data-contract.ts',
  'packages/contracts/test/unit/data-contract.test.ts',
  'packages/transform/project/linter/platform_rules.py',
  'packages/transform/test/unit/sqlmesh-project.test.ts',
];

/** Tracked and untracked files, without what Git ignores (dependencies, environments, data). */
function repositoryFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
}

// The extraction tool is this package's business (docs/21 §3): no other layer names it, so
// replacing it touches this package alone. Documentation may name it — that is where the choice
// is explained.
describe('the ingestion tool stays inside packages/ingestion', () => {
  it('is named by no other file but the known exceptions (decision D2)', () => {
    const naming = repositoryFiles()
      .filter((file) => !file.startsWith(PACKAGE) && !file.endsWith('.md'))
      .filter((file) => {
        try {
          return /dlt/i.test(readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8'));
        } catch {
          // Listed but gone from the working tree (deleted, not yet committed).
          return false;
        }
      });

    expect(naming.sort()).toEqual([...KNOWN_EXCEPTIONS].sort());
  });
});
