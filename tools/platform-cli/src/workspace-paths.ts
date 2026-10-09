import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const WORKSPACE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const WORKSPACE_FILES = {
  composeFile: path.join(WORKSPACE_ROOT, 'compose.yaml'),
  envFile: path.join(WORKSPACE_ROOT, '.env'),
  envExampleFile: path.join(WORKSPACE_ROOT, '.env.example'),
  nodeVersionFile: path.join(WORKSPACE_ROOT, '.node-version'),
  rootPackageJson: path.join(WORKSPACE_ROOT, 'package.json'),
  /** Default home of lakehouse data and SQLite catalogs — `reset:local` deletes it. */
  lakehouseDataDirectory: path.join(WORKSPACE_ROOT, '.data', 'lakehouse'),
  /**
   * Default working folder of the ingestion (ATLASBI_INGESTION_DATA_PATH): the tool's local state of
   * a lakehouse — `reset:local` deletes it with the lakehouse it belongs to.
   */
  ingestionDataDirectory: path.join(WORKSPACE_ROOT, '.data', 'ingestion'),
} as const;

/**
 * What `reset:local` deletes besides the stack's volumes: the default data folders, always inside
 * .data/. A custom path set in .env is never deleted.
 */
export const LOCAL_DATA_DIRECTORIES: readonly string[] = [
  WORKSPACE_FILES.lakehouseDataDirectory,
  WORKSPACE_FILES.ingestionDataDirectory,
];

/** Compose project name, also the word typed to confirm destructive commands. */
export const PROJECT_NAME = 'atlasbi';
