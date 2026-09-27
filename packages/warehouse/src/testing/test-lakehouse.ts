import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { EnvSecretProvider, loadLakehouseConfig, SECRET_KEYS } from '@atlasbi/config';
import { LakehouseError, type LakehouseCatalogType } from '@atlasbi/contracts';
import { ensureReadOnlyRole } from '@atlasbi/database';
import { createThrowawayDatabase } from '@atlasbi/database/testing';

import { checkLakehouseExtensions } from '../adapters/duckdb/extensions.ts';
import { provisionLakehouse } from '../adapters/duckdb/provision.ts';
import { emptyLakehouse, listDataFiles } from '../adapters/duckdb/test-lakehouse-operations.ts';
import type { LakehouseSettings, LakehouseStorage } from '../lakehouse-settings.ts';

// Tests only — it reads the development .env and uses devDependencies (@atlasbi/config and
// @atlasbi/database); the package's main entry never imports it.

const WORKSPACE_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ROOT_ENV_FILE = path.join(WORKSPACE_ROOT, '.env');

/** One per tier (docs/11 §4.4): postgres keeps its data in S3, sqlite in a folder. */
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

type S3Storage = Extract<LakehouseStorage, { kind: 's3' }>;

/**
 * S3 storage of the development object storage, under a prefix of its own (`tests/<id>/`): it
 * never overlaps the developer's lakehouse (`data/`), so no cleanup of one can reach the other.
 */
export async function testS3Storage(
  access: 'writer' | 'reader',
  prefix: string,
): Promise<S3Storage> {
  loadDevelopmentEnvironment();
  const config = loadLakehouseConfig({
    ...process.env,
    ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'postgres',
  });
  if (config.storage.kind !== 's3') {
    throw new Error('the postgres tier always stores its data in S3');
  }
  const secrets = new EnvSecretProvider();
  const bucket = new URL(config.storage.url).host;
  return {
    kind: 's3',
    url: `s3://${bucket}/${prefix}`,
    endpoint: config.storage.endpoint,
    region: config.storage.region,
    useSsl: config.storage.useSsl,
    accessKeyId: await secrets.get(
      access === 'writer'
        ? SECRET_KEYS.lakehouseS3WriterAccessKeyId
        : SECRET_KEYS.lakehouseS3ReaderAccessKeyId,
    ),
    secretAccessKey: await secrets.get(
      access === 'writer'
        ? SECRET_KEYS.lakehouseS3WriterSecretAccessKey
        : SECRET_KEYS.lakehouseS3ReaderSecretAccessKey,
    ),
  };
}

export interface TestLakehouse {
  /** The writer: catalog owner and the key that owns the bucket (postgres), or the file (sqlite). */
  settings: LakehouseSettings;
  /** The reader: SELECT-only catalog role and read-only S3 key (postgres); the same file (sqlite). */
  readerSettings: LakehouseSettings;
  /** Temporary folder of this lakehouse (SQLite catalog and data folder), removed by dispose. */
  root: string;
  /** Every data file under the lakehouse's data path, relative to it. */
  listDataFiles(): Promise<string[]>;
  dispose(): Promise<void>;
}

/**
 * An isolated lakehouse, never the developer's own. PostgreSQL tier: a throwaway catalog database
 * on the local Postgres and a `tests/<id>/` prefix on the local object storage (`pnpm dev` must be
 * running). SQLite tier: a temporary folder.
 */
export async function createTestLakehouse(
  catalogType: LakehouseCatalogType,
  options: { provision?: boolean } = {},
): Promise<TestLakehouse> {
  const extensionDirectory = await installedExtensionDirectory();
  const root = await mkdtemp(path.join(tmpdir(), 'atlasbi-lakehouse-test-'));

  if (catalogType === 'sqlite') {
    const settings: LakehouseSettings = {
      catalog: { type: 'sqlite', path: path.join(root, 'catalog', 'catalog.sqlite') },
      storage: { kind: 'folder', path: path.join(root, 'files') },
      extensionDirectory,
    };
    if (options.provision ?? true) {
      await provisionLakehouse(settings);
    }
    return {
      settings,
      readerSettings: settings,
      root,
      listDataFiles: () => listDataFiles(settings),
      dispose: () => removeFolder(root),
    };
  }

  const adminUrl = await developmentAdminUrl();
  const database = await createThrowawayDatabase(adminUrl);
  const prefix = `tests/${randomUUID()}/`;
  const settings: LakehouseSettings = {
    catalog: { type: 'postgres', connectionString: database.connectionString },
    storage: await testS3Storage('writer', prefix),
    extensionDirectory,
  };
  const dispose = async () => {
    try {
      // Whoever provisioned it — this helper or the test itself — its files are emptied here.
      await emptyLakehouse(settings).catch((error: unknown) => {
        if (!(error instanceof LakehouseError && error.code === 'catalog_unreachable')) {
          throw error;
        }
      });
      const left = await listDataFiles(settings);
      if (left.length > 0) {
        throw new Error(
          `The test lakehouse left ${left.length} object(s) behind: ${left.join(', ')}`,
        );
      }
    } finally {
      await database.drop();
      await removeFolder(root);
    }
  };
  try {
    if (options.provision ?? true) {
      await provisionLakehouse(settings);
    }
    const readerUrl = await readerUrlFor(database.connectionString);
    await ensureReadOnlyRole({
      adminConnectionString: adminUrl,
      readerConnectionString: readerUrl,
      owner: decodeURIComponent(new URL(database.connectionString).username),
    });
    const readerSettings: LakehouseSettings = {
      catalog: { type: 'postgres', connectionString: readerUrl },
      storage: await testS3Storage('reader', prefix),
      extensionDirectory,
    };
    return {
      settings,
      readerSettings,
      root,
      listDataFiles: () => listDataFiles(settings),
      dispose,
    };
  } catch (error) {
    // A half-built lakehouse still owns a database and maybe objects: never leave them behind.
    await dispose().catch(() => undefined);
    throw error;
  }
}

/** The development reader role (`lakehouse.catalog-reader-url`), pointed at a throwaway catalog. */
async function readerUrlFor(catalogUrl: string): Promise<string> {
  const reader = new URL(await new EnvSecretProvider().get(SECRET_KEYS.lakehouseCatalogReaderUrl));
  reader.pathname = new URL(catalogUrl).pathname;
  return reader.toString();
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
