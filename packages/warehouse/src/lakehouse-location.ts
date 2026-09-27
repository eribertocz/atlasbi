import path from 'node:path';

import { LakehouseError } from '@atlasbi/contracts';

import type { LakehouseSettings, LakehouseStorageKind } from './lakehouse-settings.ts';

export interface LakehouseLocation {
  storageKind: LakehouseStorageKind;
  /**
   * The exact text the catalog records and compares: an absolute folder path with forward
   * slashes, or an `s3://bucket/prefix/` URL — always with the trailing slash.
   */
  dataPath: string;
  /** Absolute path of the SQLite catalog file, forward slashes; undefined for PostgreSQL. */
  sqliteCatalogPath: string | undefined;
  extensionDirectory: string;
}

// Same rule as Config Schema v4: bucket naming per S3, trailing slash as DuckLake records it.
const S3_URL = /^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/(?:[^\s/]+\/)*$/;

/**
 * One canonical spelling per path: the catalog compares the data path textually, so
 * `C:\lake\files` and `C:/lake/files/` must never both reach it.
 */
export function resolveLakehouseLocation(settings: LakehouseSettings): LakehouseLocation {
  return {
    storageKind: settings.storage.kind,
    dataPath:
      settings.storage.kind === 'folder'
        ? withTrailingSlash(toForwardSlashes(path.resolve(settings.storage.path)))
        : checkedS3Url(settings.storage.url),
    sqliteCatalogPath:
      settings.catalog.type === 'sqlite'
        ? toForwardSlashes(path.resolve(settings.catalog.path))
        : undefined,
    extensionDirectory: toForwardSlashes(path.resolve(settings.extensionDirectory)),
  };
}

function checkedS3Url(url: string): string {
  if (!S3_URL.test(url)) {
    throw new LakehouseError(
      'storage_unreachable',
      'The lakehouse S3 URL is unusable: it must look like s3://bucket/ or s3://bucket/prefix/.',
      { remedy: 'Fix ATLASBI_LAKEHOUSE_S3_URL (docs/11 §4.4).' },
    );
  }
  return url;
}

function toForwardSlashes(value: string): string {
  return value.replaceAll('\\', '/');
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
