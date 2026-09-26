import type { QueryParameter } from './query-result.ts';

/** Contract version of {@link LakehouseAdminPort} (docs/21 §2). */
export const LAKEHOUSE_ADMIN_PORT_VERSION = 1;

/** Catalog databases the platform supports (docs/01 §6.6); a DuckDB-file catalog is not one. */
export const LAKEHOUSE_CATALOG_TYPES = ['postgres', 'sqlite'] as const;

export type LakehouseCatalogType = (typeof LAKEHOUSE_CATALOG_TYPES)[number];

export interface ExecuteResult {
  /** Base-10 string, like every 64-bit count the lakehouse returns. */
  affectedRows: string;
}

export interface FlushResult {
  rowsFlushed: string;
}

export interface LakehouseHealth {
  /**
   * UUID assigned once, when the lakehouse is provisioned. A lakehouse created again — even at the
   * same location — gets a new one; a copied or relocated lakehouse keeps it. Other state that
   * belongs to one lakehouse (SQLMesh's) is keyed by it.
   */
  lakehouseId: string;
  catalogType: LakehouseCatalogType;
  /** Persisted catalog format; the adapter rejects formats it does not support. */
  catalogFormatVersion: string;
  engineVersion: string;
  inlining: {
    rowLimit: number;
    /** Rows written into the catalog and not yet flushed to data files. */
    pendingRows: string;
  };
}

export interface LakehouseAdminCapabilities {
  /** False for catalogs with a single writing process (SQLite): writes are serialized in-process. */
  readonly concurrentWriters: boolean;
}

/**
 * Administration and writes (docs/01 §7): seeding, maintenance and, later, Input Tables.
 * One statement per `execute`; explicit multi-statement transactions are not offered.
 */
export interface LakehouseAdminPort {
  readonly capabilities: LakehouseAdminCapabilities;
  execute(statement: string, parameters?: readonly QueryParameter[]): Promise<ExecuteResult>;
  checkHealth(): Promise<LakehouseHealth>;
  /** Moves rows kept in the catalog by data inlining into data files (docs/01, Inlining v1). */
  flushInlinedData(): Promise<FlushResult>;
  /** Releases the engine; later calls reject with `engine_closed`. Safe to call twice. */
  close(): Promise<void>;
}
