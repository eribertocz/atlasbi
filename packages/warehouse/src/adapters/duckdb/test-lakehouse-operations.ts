import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';

import { resolveLakehouseLocation } from '../../lakehouse-location.ts';
import type { LakehouseSettings } from '../../lakehouse-settings.ts';
import { instanceOptions, openLakehouseInstance } from './instance-initializer.ts';
import { quoteLiteral } from './sql-literals.ts';
import { createStorageSecretStatement } from './storage-secret.ts';

// Only for the `@atlasbi/warehouse/testing` entry: tests need to see and to empty a lakehouse's data
// files, which no port offers — and must not import DuckDB to do it.

/** Every data file under the lakehouse's data path, relative to it; works unprovisioned too. */
export async function listDataFiles(settings: LakehouseSettings): Promise<string[]> {
  const { dataPath, extensionDirectory } = resolveLakehouseLocation(settings);
  if (settings.storage.kind === 'folder') {
    if (!existsSync(dataPath)) {
      return [];
    }
    const entries = await readdir(dataPath, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path.relative(dataPath, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'),
      )
      .sort();
  }
  // The storage key alone — no lakehouse attached, so an unprovisioned one can be listed too.
  const instance = await DuckDBInstance.create(':memory:', instanceOptions(extensionDirectory));
  const connection = await instance.connect();
  try {
    await connection.run('LOAD httpfs');
    await connection.run(createStorageSecretStatement(settings.storage, dataPath));
    const reader = await connection.runAndReadAll(
      `SELECT file FROM glob(${quoteLiteral(`${dataPath}**`)}) ORDER BY file`,
    );
    return reader.getRows().map(([file]) => String(file).slice(dataPath.length));
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

/**
 * Deletes every data file of a lakehouse through DuckLake itself — drop every table, expire the
 * snapshots, remove the files they used and any orphan — so no S3 request is signed by hand.
 */
export async function emptyLakehouse(settings: LakehouseSettings): Promise<void> {
  const instance = await openLakehouseInstance(settings, 'write');
  const connection = await instance.connect();
  try {
    const tables = await connection.runAndReadAll(
      "SELECT schema_name, table_name FROM duckdb_tables() WHERE database_name = 'lake'",
    );
    for (const [schema, table] of tables.getRows()) {
      await connection.run(`DROP TABLE lake."${String(schema)}"."${String(table)}"`);
    }
    await connection.run("CALL ducklake_expire_snapshots('lake', older_than => now())");
    await connection.run("CALL ducklake_cleanup_old_files('lake', cleanup_all => true)");
    await connection.run("CALL ducklake_delete_orphaned_files('lake', cleanup_all => true)");
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}
