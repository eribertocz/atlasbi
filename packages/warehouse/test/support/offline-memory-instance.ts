import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';

import { instanceOptions } from '../../src/adapters/duckdb/instance-initializer.ts';

/**
 * An in-memory DuckDB with the runtime's offline options and an empty, throwaway extension
 * directory. Never `DuckDBInstance.create(':memory:')` with defaults: they silently download
 * extensions into the user's global ~/.duckdb (this happened once, in this very test suite).
 */
export function createOfflineMemoryInstance(): Promise<DuckDBInstance> {
  const extensionDirectory = mkdtempSync(path.join(tmpdir(), 'atlasbi-no-extensions-'));
  return DuckDBInstance.create(
    ':memory:',
    instanceOptions(extensionDirectory.replaceAll('\\', '/')),
  );
}
