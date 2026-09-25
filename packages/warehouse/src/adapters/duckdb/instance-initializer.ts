import { existsSync } from 'node:fs';

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

import { LakehouseError, type LakehouseCatalogType } from '@atlasbi/contracts';

import { resolveLakehouseLocation } from '../../lakehouse-location.ts';
import type { LakehouseSettings } from '../../lakehouse-settings.ts';
import {
  buildAttachStatement,
  type EngineCatalog,
  type LakehouseAccess,
} from './attach-statement.ts';
import { createCatalogSecretStatement, parsePostgresCatalogUrl } from './catalog-secret.ts';
import { PROVISION_REMEDY, toLakehouseError } from './error-mapper.ts';
import { listLiteral } from './sql-literals.ts';

/** DuckDB extension each catalog needs besides ducklake (LOAD accepts these aliases). */
const CATALOG_EXTENSIONS: Record<LakehouseCatalogType, string> = {
  postgres: 'postgres',
  sqlite: 'sqlite',
};

/**
 * Creation options: the extension directory belongs to the project, and nothing is ever installed
 * or loaded implicitly — DuckDB's defaults would download a missing extension silently (S3).
 */
export function instanceOptions(extensionDirectory: string): Record<string, string> {
  return {
    extension_directory: extensionDirectory,
    autoinstall_known_extensions: 'false',
    autoload_known_extensions: 'false',
    allow_unsigned_extensions: 'false',
  };
}

// DuckLake's own commit retries, pinned to today's defaults so a new release cannot change them silently.
const DUCKLAKE_RETRY_SETTINGS = [
  ['ducklake_max_retry_count', '10'],
  ['ducklake_retry_wait_ms', '100'],
  ['ducklake_retry_backoff', '1.5'],
] as const;

/**
 * Once per instance (Phase 0, S2: LOAD, secrets, ATTACH and unqualified settings are
 * instance-wide): load → settings → catalog secret → attach → read-only hardening. Extension
 * settings only exist after their LOAD, and the hardening order is the one S4 validated.
 */
export async function openLakehouseInstance(
  settings: LakehouseSettings,
  access: LakehouseAccess,
): Promise<DuckDBInstance> {
  const location = resolveLakehouseLocation(settings);
  // SQLite would create an empty file on ATTACH; outside provisioning, nothing may be created.
  if (
    access !== 'provision' &&
    location.sqliteCatalogPath !== undefined &&
    !existsSync(location.sqliteCatalogPath)
  ) {
    throw new LakehouseError(
      'catalog_unreachable',
      `No lakehouse has been provisioned: the SQLite catalog ${location.sqliteCatalogPath} does not exist.`,
      { remedy: PROVISION_REMEDY },
    );
  }
  let instance: DuckDBInstance;
  try {
    instance = await DuckDBInstance.create(
      ':memory:',
      instanceOptions(location.extensionDirectory),
    );
  } catch (error) {
    throw toLakehouseError(error);
  }
  let connection: DuckDBConnection | undefined;
  try {
    connection = await instance.connect();
    await connection.run('LOAD ducklake');
    await connection.run(`LOAD ${CATALOG_EXTENSIONS[settings.catalog.type]}`);
    await connection.run("SET GLOBAL TimeZone = 'UTC'");
    for (const [name, value] of DUCKLAKE_RETRY_SETTINGS) {
      await connection.run(`SET GLOBAL ${name} = ${value}`);
    }
    let catalog: EngineCatalog;
    if (settings.catalog.type === 'postgres') {
      await connection.run(
        createCatalogSecretStatement(parsePostgresCatalogUrl(settings.catalog.connectionString)),
      );
      catalog = { type: 'postgres' };
    } else {
      catalog = { type: 'sqlite', path: location.sqliteCatalogPath ?? '' };
    }
    await connection.run(
      buildAttachStatement({
        catalog,
        dataPath: location.dataPath,
        access,
        overrideDataPath: settings.overrideDataPath ?? false,
      }),
    );
    if (access === 'read') {
      await connection.run(`SET GLOBAL allowed_directories = ${listLiteral([location.dataPath])}`);
      if (location.sqliteCatalogPath !== undefined) {
        await connection.run(
          `SET GLOBAL allowed_paths = ${listLiteral([location.sqliteCatalogPath])}`,
        );
      }
      await connection.run('SET GLOBAL enable_external_access = false');
      await connection.run('SET GLOBAL lock_configuration = true');
    }
    return instance;
  } catch (error) {
    connection?.closeSync();
    connection = undefined;
    instance.closeSync();
    throw toLakehouseError(error);
  } finally {
    connection?.closeSync();
  }
}
