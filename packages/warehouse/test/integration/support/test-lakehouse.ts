import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { EnvSecretProvider, loadLakehouseConfig, SECRET_KEYS } from '@atlasbi/config';
import type { LakehouseCatalogType } from '@atlasbi/contracts';
import { createThrowawayDatabase } from '@atlasbi/database/testing';

import {
  checkLakehouseExtensions,
  provisionLakehouse,
  type LakehouseSettings,
} from '../../../src/index.ts';

const WORKSPACE_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const ROOT_ENV_FILE = path.join(WORKSPACE_ROOT, '.env');

export const CATALOG_TYPES: readonly LakehouseCatalogType[] = ['postgres', 'sqlite'];

let environmentLoaded = false;
function loadDevelopmentEnvironment(): void {
  if (!environmentLoaded && existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  environmentLoaded = true;
}

/** The extensions `pnpm bootstrap` installed — tests never download anything either. */
export async function installedExtensionDirectory(): Promise<string> {
  loadDevelopmentEnvironment();
  const { extensionDirectory } = loadLakehouseConfig(process.env, {
    baseDirectory: WORKSPACE_ROOT,
  });
  const statuses = await checkLakehouseExtensions(extensionDirectory);
  if (statuses.some((status) => status.state !== 'ready')) {
    throw new Error(
      `The DuckDB extensions are not installed in ${extensionDirectory}: run \`pnpm bootstrap\` once before the integration tests.`,
    );
  }
  return extensionDirectory;
}

export async function developmentAdminUrl(): Promise<string> {
  loadDevelopmentEnvironment();
  return new EnvSecretProvider().get(SECRET_KEYS.databaseUrl);
}

export interface TestLakehouse {
  settings: LakehouseSettings;
  /** Folder holding the data files (and the SQLite catalog), removed by dispose. */
  root: string;
  dispose(): Promise<void>;
}

/**
 * An isolated lakehouse: a temporary folder, plus a throwaway database on the local Postgres for a
 * PostgreSQL catalog (`pnpm dev` must be running). Never the developer's own lakehouse.
 */
export async function createTestLakehouse(
  catalogType: LakehouseCatalogType,
  options: { provision?: boolean } = {},
): Promise<TestLakehouse> {
  const extensionDirectory = await installedExtensionDirectory();
  const root = await mkdtemp(path.join(tmpdir(), 'atlasbi-lakehouse-test-'));
  const database =
    catalogType === 'postgres'
      ? await createThrowawayDatabase(await developmentAdminUrl())
      : undefined;
  const settings: LakehouseSettings = {
    catalog:
      database === undefined
        ? { type: 'sqlite', path: path.join(root, 'catalog', 'catalog.sqlite') }
        : { type: 'postgres', connectionString: database.connectionString },
    dataPath: path.join(root, 'files'),
    extensionDirectory,
  };
  if (options.provision ?? true) {
    await provisionLakehouse(settings);
  }
  return {
    settings,
    root,
    dispose: async () => {
      await database?.drop();
      await removeFolder(root);
    },
  };
}

// Windows may keep a just-closed file handle for a moment; retry instead of leaking temp folders.
export async function removeFolder(folder: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rm(folder, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt >= 5) {
        throw error;
      }
      await delay(200 * attempt);
    }
  }
}
