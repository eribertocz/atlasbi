import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';

import { instanceOptions } from '../../src/adapters/duckdb/instance-initializer.ts';

/**
 * An in-memory DuckDB with the runtime's offline options and an extension directory that stays
 * empty. Never `DuckDBInstance.create(':memory:')` with defaults: they silently download
 * extensions into the user's global ~/.duckdb (this happened once, in this very test suite).
 */
export function createOfflineMemoryInstance(): Promise<DuckDBInstance> {
  // One stable folder, reused by every run: it always stays empty (nothing is ever installed),
  // so there is nothing to clean up and no temporary folder is left behind per run.
  const extensionDirectory = path.join(tmpdir(), 'atlasbi-no-extensions');
  mkdirSync(extensionDirectory, { recursive: true });
  return DuckDBInstance.create(
    ':memory:',
    instanceOptions(extensionDirectory.replaceAll('\\', '/')),
  );
}
