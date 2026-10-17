import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findToolMentions } from '../../src/index.ts';

const FILES: Readonly<Record<string, string>> = {
  '.gitignore': 'ignored/\n',
  'packages/owner/src/adapter.ts': 'runs ExampleTool',
  'packages/owner-extras/src/leak.ts': '// wraps exampletool too',
  'packages/other/src/clean.ts': 'nothing to see',
  'packages/other/src/leak.ts': 'calls EXAMPLETOOL directly',
  'docs/why.md': 'we chose ExampleTool because…',
  'ignored/cache.ts': 'ExampleTool cache',
};

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'atlasbi-tool-confinement-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  for (const [file, text] of Object.entries(FILES)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('findToolMentions', () => {
  it('finds the files outside the owner that name the tool, never Markdown or what Git ignores', () => {
    expect(
      findToolMentions({
        pattern: /exampletool/i,
        ownerPackage: 'packages/owner',
        repositoryRoot: root,
      }),
    ).toEqual(['packages/other/src/leak.ts', 'packages/owner-extras/src/leak.ts']);
  });

  it('treats the owner as a folder, not a prefix: a sibling with a longer name is outside', () => {
    expect(
      findToolMentions({
        pattern: /exampletool/i,
        ownerPackage: 'packages/owner/',
        repositoryRoot: root,
      }),
    ).toContain('packages/owner-extras/src/leak.ts');
  });

  it('gives the same answer with a global pattern, whose test() would otherwise keep state', () => {
    const search = {
      pattern: /exampletool/gi,
      ownerPackage: 'packages/owner',
      repositoryRoot: root,
    };

    expect(findToolMentions(search)).toEqual(findToolMentions(search));
    expect(findToolMentions(search)).toHaveLength(2);
  });
});
