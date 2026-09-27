import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

import { toLakehouseError } from './error-mapper.ts';
import { instanceOptions } from './instance-initializer.ts';
import { quoteLiteral } from './sql-literals.ts';

/**
 * Installed together whatever the configured tier, so switching catalog type never needs the
 * Internet: httpfs reads and writes the S3 data files of the postgres tier. DuckDB registers
 * postgres and sqlite as postgres_scanner and sqlite_scanner (S1).
 */
const LAKEHOUSE_EXTENSIONS = [
  { name: 'ducklake', registeredAs: 'ducklake' },
  { name: 'postgres', registeredAs: 'postgres_scanner' },
  { name: 'sqlite', registeredAs: 'sqlite_scanner' },
  { name: 'httpfs', registeredAs: 'httpfs' },
] as const;

export type ExtensionState = 'ready' | 'missing' | 'unloadable';

export interface ExtensionStatus {
  name: string;
  state: ExtensionState;
  version: string | undefined;
}

/** Bootstrap only — the one moment the platform downloads anything from DuckDB's repository. */
export async function installLakehouseExtensions(
  extensionDirectory: string,
): Promise<ExtensionStatus[]> {
  await mkdir(extensionDirectory, { recursive: true });
  return withExtensionInstance(extensionDirectory, async (connection) => {
    for (const extension of LAKEHOUSE_EXTENSIONS) {
      await connection.run(`INSTALL ${extension.name}`);
    }
    return inspect(connection);
  });
}

/**
 * Offline verification (preflight, health): installed in the project directory, and LOAD succeeds
 * — which also verifies the signature, since unsigned extensions are refused.
 */
export async function checkLakehouseExtensions(
  extensionDirectory: string,
): Promise<ExtensionStatus[]> {
  return withExtensionInstance(extensionDirectory, inspect);
}

async function inspect(connection: DuckDBConnection): Promise<ExtensionStatus[]> {
  const names = LAKEHOUSE_EXTENSIONS.map((extension) => quoteLiteral(extension.registeredAs));
  const reader = await connection.runAndReadAll(
    `SELECT extension_name, installed, extension_version FROM duckdb_extensions() WHERE extension_name IN (${names.join(', ')})`,
  );
  const rows = reader.getRowObjectsJson();
  const statuses: ExtensionStatus[] = [];
  for (const extension of LAKEHOUSE_EXTENSIONS) {
    const row = rows.find((candidate) => candidate.extension_name === extension.registeredAs);
    if (row?.installed !== true) {
      statuses.push({ name: extension.name, state: 'missing', version: undefined });
      continue;
    }
    const version = typeof row.extension_version === 'string' ? row.extension_version : undefined;
    try {
      await connection.run(`LOAD ${extension.name}`);
      statuses.push({ name: extension.name, state: 'ready', version });
    } catch {
      statuses.push({ name: extension.name, state: 'unloadable', version });
    }
  }
  return statuses;
}

async function withExtensionInstance<T>(
  extensionDirectory: string,
  work: (connection: DuckDBConnection) => Promise<T>,
): Promise<T> {
  let instance: DuckDBInstance;
  try {
    instance = await DuckDBInstance.create(
      ':memory:',
      instanceOptions(path.resolve(extensionDirectory).replaceAll('\\', '/')),
    );
  } catch (error) {
    throw toLakehouseError(error);
  }
  const connection = await instance.connect();
  try {
    return await work(connection);
  } catch (error) {
    throw toLakehouseError(error);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}
