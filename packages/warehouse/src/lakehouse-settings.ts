import type { LakehouseCatalogType } from '@atlasbi/contracts';

export type LakehouseCatalog =
  { type: 'postgres'; connectionString: string } | { type: 'sqlite'; path: string };

/** Where the Parquet data files live. The catalog records the path at provisioning. */
export type LakehouseStorage =
  | {
      kind: 'folder';
      /** Must match the folder the catalog recorded at provisioning. */
      path: string;
      /**
       * Reads the data files from `path` even though the catalog recorded another folder — a
       * copied or mounted lakehouse (docs/01). Applies to this process only; nothing is persisted.
       */
      overrideDataPath?: boolean;
    }
  | {
      kind: 's3';
      /** `s3://bucket/prefix/`, identical for every process that opens this lakehouse. */
      url: string;
      /** host:port of the S3 API as seen from this process — never a scheme. */
      endpoint: string;
      region: string;
      useSsl: boolean;
      /** The writer key owns the bucket; the reader key can only read it (docs/01 §6.7). */
      accessKeyId: string;
      secretAccessKey: string;
    };

export type LakehouseStorageKind = LakehouseStorage['kind'];

/** Everything a process needs to open the lakehouse; built by the caller from config + secrets. */
export interface LakehouseSettings {
  catalog: LakehouseCatalog;
  storage: LakehouseStorage;
  /** DuckDB extensions installed by bootstrap; the runtime only loads them, never downloads. */
  extensionDirectory: string;
}

const CATALOG_DISPLAY_NAMES: Record<LakehouseCatalogType, string> = {
  postgres: 'PostgreSQL',
  sqlite: 'SQLite',
};

const STORAGE_DISPLAY_NAMES: Record<LakehouseStorageKind, string> = {
  folder: 'local folder',
  s3: 'S3',
};

export function describeCatalogType(type: LakehouseCatalogType): string {
  return CATALOG_DISPLAY_NAMES[type];
}

export function describeStorageKind(kind: LakehouseStorageKind): string {
  return STORAGE_DISPLAY_NAMES[kind];
}
