import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDataContract } from '@atlasbi/contracts';
import { describe, expect, it } from 'vitest';

import { CONSUMED_DATA_CONTRACTS } from '../../src/index.ts';

const MODEL_DIRECTORY = fileURLToPath(new URL('../../cube/model/cubes/', import.meta.url));

// The lakehouse tables the Cube model reads are exactly the ones whose contracts this layer
// consumes (docs/21 §2.4): a table without a contract is an implicit dependency on another layer.
describe('data contracts in the Cube model', () => {
  it('reads only tables of the data contracts it consumes, and all of them', async () => {
    const referenced = new Set<string>();
    for (const file of await readdir(MODEL_DIRECTORY)) {
      const yaml = await readFile(path.join(MODEL_DIRECTORY, file), 'utf8');
      for (const match of yaml.matchAll(/\blake\.([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g)) {
        referenced.add(`${match[1] ?? ''}.${match[2] ?? ''}`);
      }
    }
    const contracted = CONSUMED_DATA_CONTRACTS.map(({ id, major }) => {
      const { table } = getDataContract(id, major);
      return `${table.schema}.${table.name}`;
    });

    expect([...referenced].sort()).toEqual([...new Set(contracted)].sort());
  });
});
