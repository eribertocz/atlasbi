import type { LakehouseCatalogType } from '@atlasbi/contracts';

export type LakehouseCatalog =
  { type: 'postgres'; connectionString: string } | { type: 'sqlite'; path: string };

/** Everything a process needs to open the lakehouse; built by the caller from config + secrets. */
export interface LakehouseSettings {
  catalog: LakehouseCatalog;
  /** Folder of the Parquet data files. Must match the path the catalog recorded at provisioning. */
  dataPath: string;
  /** DuckDB extensions installed by bootstrap; the runtime only loads them, never downloads. */
  extensionDirectory: string;
  /**
   * Reads the data files from `dataPath` even though the catalog recorded another folder — a
   * copied or mounted lakehouse (docs/01). Applies to this process only; nothing is persisted.
   */
  overrideDataPath?: boolean;
}

const CATALOG_DISPLAY_NAMES: Record<LakehouseCatalogType, string> = {
  postgres: 'PostgreSQL',
  sqlite: 'SQLite',
};

export function describeCatalogType(type: LakehouseCatalogType): string {
  return CATALOG_DISPLAY_NAMES[type];
}
