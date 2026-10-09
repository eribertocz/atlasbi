import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { semanticModelVersion, SEMANTIC_MODEL_DIRECTORY } from '../../src/index.ts';

describe('semanticModelVersion (decision D3)', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'atlasbi-cube-'));
    await mkdir(path.join(directory, 'model', 'cubes'), { recursive: true });
    await writeFile(path.join(directory, 'cube.js'), 'module.exports = {};\n');
    await writeFile(path.join(directory, 'model', 'cubes', 'a.yml'), 'cubes: []\n');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('stays the same while nothing changes, whatever the line endings', async () => {
    const first = await semanticModelVersion(directory);
    await writeFile(path.join(directory, 'model', 'cubes', 'a.yml'), 'cubes: []\r\n');

    expect(await semanticModelVersion(directory)).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes with a file edited, added or renamed', async () => {
    const versions = new Set([await semanticModelVersion(directory)]);
    await writeFile(path.join(directory, 'model', 'cubes', 'a.yml'), 'cubes:\n  - name: a\n');
    versions.add(await semanticModelVersion(directory));
    await writeFile(path.join(directory, 'model', 'cubes', 'b.yml'), 'cubes: []\n');
    versions.add(await semanticModelVersion(directory));
    await rm(path.join(directory, 'model', 'cubes', 'b.yml'));
    await writeFile(path.join(directory, 'model', 'cubes', 'c.yml'), 'cubes: []\n');
    versions.add(await semanticModelVersion(directory));

    expect(versions.size).toBe(4);
  });

  it('reads the folder the Cube container mounts', async () => {
    await expect(semanticModelVersion(SEMANTIC_MODEL_DIRECTORY)).resolves.toMatch(/^[0-9a-f]{16}$/);
  });
});
