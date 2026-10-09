import type { QueryParameter } from './query-result.ts';

/**
 * Contract version of {@link LakehouseAdminPort} (docs/21 §2), `MAJOR.MINOR` like
 * `ANALYTICAL_QUERY_PORT_VERSION`. 1.1 added the `storage_unreachable` error code; 1.2 added
 * `maintain` (Plan C, docs/01 §6.8).
 */
export const LAKEHOUSE_ADMIN_PORT_VERSION = '1.2';

/** Catalog databases the platform supports (docs/01 §6.6); a DuckDB-file catalog is not one. */
export const LAKEHOUSE_CATALOG_TYPES = ['postgres', 'sqlite'] as const;

export type LakehouseCatalogType = (typeof LAKEHOUSE_CATALOG_TYPES)[number];

export interface ExecuteResult {
  /** Base-10 string, like every 64-bit count the lakehouse returns. */
  affectedRows: string;
}

/**
 * Below this, an orphan sweep deletes the files a writer has uploaded but not committed yet — and
 * the table it then commits points at files that no longer exist (measured in Plan C, Phase 0).
 * Configuration and the command line refuse anything lower, and so does the port.
 */
export const MIN_ORPHAN_GRACE_HOURS = 1;

/** The retention of docs/01 §6.8, explicit and configurable. */
export interface MaintenancePolicy {
  /** Older versions expire: no time travel to them afterwards. */
  snapshotRetentionDays: number;
  /** A file the expiration freed is deleted only once it has been scheduled this long. */
  cleanupGraceMinutes: number;
  /** A file the catalog does not know is deleted only once it is this old (MIN_ORPHAN_GRACE_HOURS). */
  orphanGraceHours: number;
}

/** What one maintenance run did — or, with `dryRun`, would do. */
export interface MaintenanceReport {
  dryRun: boolean;
  expiredSnapshots: number;
  deletedFiles: number;
  deletedOrphans: number;
  /** Tables whose small files were (or would be) merged; the files they replace go in a later run. */
  compactedTables: number;
}

/** Why a policy cannot be used; empty when it can. */
export function maintenancePolicyIssues(policy: MaintenancePolicy): string[] {
  const issues: string[] = [];
  const whole = (value: number) => Number.isInteger(value) && value >= 0;
  if (!whole(policy.snapshotRetentionDays)) {
    issues.push('the snapshot retention is a whole number of days, 0 or more');
  }
  if (!whole(policy.cleanupGraceMinutes)) {
    issues.push('the cleanup grace is a whole number of minutes, 0 or more');
  }
  if (!whole(policy.orphanGraceHours) || policy.orphanGraceHours < MIN_ORPHAN_GRACE_HOURS) {
    issues.push(
      `the orphan grace is a whole number of hours, at least ${MIN_ORPHAN_GRACE_HOURS}: a shorter one deletes files writers have not committed yet`,
    );
  }
  return issues;
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
  /**
   * Retention (docs/01 §6.8): expires old versions, deletes the files they alone used and the
   * orphans past their grace, and compacts small files. With `dryRun`, changes nothing and says what
   * it would do. Rejects a policy `maintenancePolicyIssues` refuses (RangeError).
   */
  maintain(policy: MaintenancePolicy, options?: { dryRun?: boolean }): Promise<MaintenanceReport>;
  /** Releases the engine; later calls reject with `engine_closed`. Safe to call twice. */
  close(): Promise<void>;
}
