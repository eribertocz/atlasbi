import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { getDataContract } from '@atlasbi/contracts';
import { lakehouseSqlType } from '@atlasbi/warehouse/testing';
import { describe, expect, it } from 'vitest';

import { CONSUMED_DATA_CONTRACTS, PRODUCED_DATA_CONTRACTS } from '../../src/index.ts';
import { SQLMESH_PROJECT_DIRECTORY } from '../../src/run-sqlmesh.ts';

/** The columns `external_models.yaml` declares for one external model, as `name → type`. */
function declaredColumns(yaml: string, model: string): Record<string, string> {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `- name: ${model}`);
  if (start === -1) {
    return {};
  }
  const columns: Record<string, string> = {};
  let inColumns = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('- ')) {
      break;
    }
    if (/^ {2}columns:\s*$/.test(line)) {
      inColumns = true;
      continue;
    }
    const column = /^ {4}([a-z_][a-z0-9_]*):\s*(.+)$/.exec(line);
    if (inColumns && column !== null) {
      columns[column[1] ?? ''] = (column[2] ?? '').trim();
    } else if (/^ {2}\S/.test(line)) {
      inColumns = false;
    }
  }
  return columns;
}

async function modelNames(): Promise<string[]> {
  const names: string[] = [];
  const models = path.join(SQLMESH_PROJECT_DIRECTORY, 'models');
  for (const entry of await readdir(models, { recursive: true })) {
    if (entry.endsWith('.sql')) {
      const sql = await readFile(path.join(models, entry), 'utf8');
      const name = /^\s*name\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*,/m.exec(sql)?.[1];
      if (name !== undefined) {
        names.push(name);
      }
    }
  }
  return names;
}

// The SQLMesh side of the data contracts (docs/21 §2.4); the published tables themselves are
// checked against them in the integration tests.
describe('data contracts in the SQLMesh project', () => {
  it('declares every source it reads exactly as the source contract says', async () => {
    const yaml = await readFile(
      path.join(SQLMESH_PROJECT_DIRECTORY, 'external_models.yaml'),
      'utf8',
    );

    for (const { id, major } of CONSUMED_DATA_CONTRACTS) {
      const contract = getDataContract(id, major);
      const model = `lake.${contract.table.schema}.${contract.table.name}`;

      expect(declaredColumns(yaml, model), `${id}@${major} as ${model}`).toEqual(
        Object.fromEntries(
          contract.columns.map((column) => [column.name, lakehouseSqlType(column.type)]),
        ),
      );
    }
  });

  it('publishes every mart under the table its contract names', async () => {
    const names = await modelNames();

    for (const { id, major } of PRODUCED_DATA_CONTRACTS) {
      const { table } = getDataContract(id, major);
      expect(names, `${id}@${major}`).toContain(`${table.schema}.${table.name}`);
    }
  });
});
