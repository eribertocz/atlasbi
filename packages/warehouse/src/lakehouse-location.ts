import path from 'node:path';

import type { LakehouseSettings } from './lakehouse-settings.ts';

export interface LakehouseLocation {
  /** Absolute, forward slashes, trailing slash — the exact form recorded in the catalog. */
  dataPath: string;
  /** Absolute path of the SQLite catalog file, forward slashes; undefined for PostgreSQL. */
  sqliteCatalogPath: string | undefined;
  extensionDirectory: string;
}

/**
 * One canonical spelling per path: the catalog compares the data path textually, so
 * `C:\lake\files` and `C:/lake/files/` must never both reach it.
 */
export function resolveLakehouseLocation(settings: LakehouseSettings): LakehouseLocation {
  return {
    dataPath: withTrailingSlash(toForwardSlashes(path.resolve(settings.dataPath))),
    sqliteCatalogPath:
      settings.catalog.type === 'sqlite'
        ? toForwardSlashes(path.resolve(settings.catalog.path))
        : undefined,
    extensionDirectory: toForwardSlashes(path.resolve(settings.extensionDirectory)),
  };
}

function toForwardSlashes(value: string): string {
  return value.replaceAll('\\', '/');
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
