import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkWritableFolder } from '../../src/checks/lakehouse-checks.ts';
import { describeExtensions, lakehouseReadinessDetail } from '../../src/health/lakehouse-probes.ts';

describe('lakehouse readiness line', () => {
  it('names the catalog, and always carries the single-writer note for SQLite', () => {
    expect(lakehouseReadinessDetail('postgres')).toBe('healthy — Catalog: PostgreSQL');
    expect(lakehouseReadinessDetail('sqlite')).toBe(
      'healthy — Catalog: SQLite (single-writer mode — recommended for individual development)',
    );
  });

  it('lists extension versions, and the state of any that is not ready', () => {
    expect(
      describeExtensions([
        { name: 'ducklake', state: 'ready', version: 'd8a1881e' },
        { name: 'postgres', state: 'missing', version: undefined },
        { name: 'sqlite', state: 'unloadable', version: 'f79b1db' },
      ]),
    ).toBe('ducklake d8a1881e, postgres (missing), sqlite (unloadable)');
  });
});

describe('checkWritableFolder', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'atlasbi-cli-check-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('passes for an existing folder, and for one bootstrap will create — creating nothing itself', async () => {
    const existing = await checkWritableFolder('Lakehouse data', root);
    const future = await checkWritableFolder('Lakehouse data', path.join(root, 'a', 'b'));

    expect(existing).toMatchObject({ status: 'pass', detail: `${root} (writable)` });
    expect(future).toMatchObject({ status: 'pass' });
    expect(future.detail).toContain('created on bootstrap');
    await expect(rm(path.join(root, 'a'))).rejects.toThrow();
  });

  it('fails when the path runs through a regular file', async () => {
    const file = path.join(root, 'not-a-folder');
    await writeFile(file, 'x');

    const result = await checkWritableFolder('Lakehouse data', path.join(file, 'files'));

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('is a file');
    expect(result.remedy).toBeDefined();
  });
});
