import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';

import { ConfigurationError, loadLakehouseConfig, type LakehouseConfig } from '@atlasbi/config';
import { checkLakehouseExtensions } from '@atlasbi/warehouse';

import { describeFailure } from '../lakehouse-environment.ts';
import { describeExtensions } from '../health/lakehouse-probes.ts';
import { WORKSPACE_ROOT } from '../workspace-paths.ts';
import type { CheckResult } from './check-result.ts';

/** Offline, read-only checks: preflight never installs, creates or downloads anything. */
export async function checkLakehouse(): Promise<CheckResult[]> {
  let lakehouse: LakehouseConfig;
  try {
    lakehouse = loadLakehouseConfig(process.env, { baseDirectory: WORKSPACE_ROOT });
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return [
        {
          name: 'Lakehouse config',
          status: 'fail',
          detail: error.issues.join('; '),
          remedy: 'Fix the ATLASBI_LAKEHOUSE_* values in .env (documented in .env.example).',
        },
      ];
    }
    throw error;
  }
  return [
    await checkDuckDBExtensions(lakehouse.extensionDirectory),
    await checkWritableFolder('Lakehouse data', lakehouse.dataPath),
    ...(lakehouse.catalogType === 'sqlite'
      ? [await checkWritableFolder('SQLite catalog', path.dirname(lakehouse.sqliteCatalogPath))]
      : []),
  ];
}

export async function checkDuckDBExtensions(extensionDirectory: string): Promise<CheckResult> {
  try {
    const statuses = await checkLakehouseExtensions(extensionDirectory);
    if (statuses.every((status) => status.state === 'ready')) {
      return { name: 'DuckDB extensions', status: 'pass', detail: describeExtensions(statuses) };
    }
    if (statuses.some((status) => status.state === 'unloadable')) {
      return {
        name: 'DuckDB extensions',
        status: 'fail',
        detail: `cannot be loaded: ${describeExtensions(statuses)}`,
        remedy: `Delete ${extensionDirectory} and run \`pnpm bootstrap\` to install them again.`,
      };
    }
    return {
      name: 'DuckDB extensions',
      status: 'warn',
      detail: 'not installed yet — `pnpm bootstrap` installs them (needs Internet once)',
    };
  } catch (error) {
    return { name: 'DuckDB extensions', status: 'fail', detail: describeFailure(error) };
  }
}

/**
 * Without creating anything: the closest existing ancestor must be a folder we may write to.
 * A path running through a regular file can never be created, whatever the permissions.
 */
export async function checkWritableFolder(name: string, folder: string): Promise<CheckResult> {
  const remedy = `Point it to a folder this user can write (see ATLASBI_LAKEHOUSE_* in .env.example).`;
  let existing = path.resolve(folder);
  for (;;) {
    try {
      const entry = await stat(existing);
      if (!entry.isDirectory()) {
        return {
          name,
          status: 'fail',
          detail: `${folder} cannot be created: ${existing} is a file`,
          remedy,
        };
      }
      break;
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) {
        return { name, status: 'fail', detail: `${folder} has no existing parent folder`, remedy };
      }
      existing = parent;
    }
  }
  try {
    await access(existing, constants.W_OK);
  } catch {
    return { name, status: 'fail', detail: `${existing} is not writable`, remedy };
  }
  const detail =
    existing === path.resolve(folder) ? `${folder} (writable)` : `${folder} (created on bootstrap)`;
  return { name, status: 'pass', detail };
}
