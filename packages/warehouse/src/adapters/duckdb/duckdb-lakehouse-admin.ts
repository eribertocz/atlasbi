import {
  LakehouseError,
  type ExecuteResult,
  type FlushResult,
  type LakehouseAdminCapabilities,
  type LakehouseAdminPort,
  type LakehouseHealth,
  maintenancePolicyIssues,
  type MaintenancePolicy,
  type MaintenanceReport,
  type QueryParameter,
} from '@atlasbi/contracts';
import type { DuckDBConnection, DuckDBResultReader } from '@duckdb/node-api';

import { INLINING_POLICY, SUPPORTED_CATALOG_FORMAT } from '../../lakehouse-policies.ts';
import { LAKE_ALIAS } from './attach-statement.ts';
import { readRows, scalarText } from './internal-reads.ts';
import { requireLakehouseIdentity } from './lakehouse-identity.ts';
import type { LakehouseEngine } from './lakehouse-engine.ts';
import { quoteLiteral } from './sql-literals.ts';
import { prepareSingleStatement } from './statement-guard.ts';
import { bindParameters } from './value-encoding.ts';
import { retryWhileCatalogBusy, WriteSerializer } from './write-serializer.ts';

const METADATA_CATALOG = `__ducklake_metadata_${LAKE_ALIAS}`;

/** LakehouseAdminPort over a writable DuckDB instance (docs/01 §6.7). */
export class DuckDBLakehouseAdmin implements LakehouseAdminPort {
  readonly capabilities: LakehouseAdminCapabilities;
  readonly #engine: LakehouseEngine;
  readonly #writes = new WriteSerializer();

  constructor(engine: LakehouseEngine) {
    this.#engine = engine;
    this.capabilities = { concurrentWriters: engine.catalogType === 'postgres' };
  }

  execute(statement: string, parameters: readonly QueryParameter[] = []): Promise<ExecuteResult> {
    return this.#write(statement, async (connection) => {
      const prepared = await prepareSingleStatement(connection, statement, 'write');
      bindParameters(prepared, parameters);
      const reader = await prepared.runAndReadAll();
      return { affectedRows: affectedRows(reader) };
    });
  }

  flushInlinedData(): Promise<FlushResult> {
    const statement = `CALL ducklake_flush_inlined_data(${quoteLiteral(LAKE_ALIAS)})`;
    return this.#write(statement, async (connection) => {
      const rows = await readRows(connection, statement);
      const flushed = rows.reduce(
        (total, row) => total + BigInt(scalarText(row.rows_flushed) ?? '0'),
        0n,
      );
      return { rowsFlushed: flushed.toString() };
    });
  }

  /**
   * Retention (docs/01 §6.8), in DuckLake's order: expire versions, delete what only they used,
   * delete orphans past their grace, compact small files. Every function's rows are read in full:
   * `SELECT count(*) FROM ducklake_expire_snapshots(…)` counts without expiring anything (measured
   * in Plan C, Phase 0). A dry run asks each function what it would do; compaction has no dry run,
   * so the tables it would touch are counted from the catalog, by the rule it follows.
   */
  async maintain(
    policy: MaintenancePolicy,
    options: { dryRun?: boolean } = {},
  ): Promise<MaintenanceReport> {
    const issues = maintenancePolicyIssues(policy);
    if (issues.length > 0) {
      throw new RangeError(`Invalid maintenance policy: ${issues.join('; ')}.`);
    }
    const lake = quoteLiteral(LAKE_ALIAS);
    const dryRun = options.dryRun === true;
    const flag = dryRun ? ', dry_run => true' : '';
    const steps = {
      expire: `SELECT * FROM ducklake_expire_snapshots(${lake}, older_than => now() - INTERVAL '${policy.snapshotRetentionDays} days'${flag})`,
      cleanup: `SELECT * FROM ducklake_cleanup_old_files(${lake}, older_than => now() - INTERVAL '${policy.cleanupGraceMinutes} minutes'${flag})`,
      orphans: `SELECT * FROM ducklake_delete_orphaned_files(${lake}, older_than => now() - INTERVAL '${policy.orphanGraceHours} hours'${flag})`,
      compact: dryRun ? undefined : `SELECT * FROM ducklake_merge_adjacent_files(${lake})`,
    };
    const rowsOf = async (statement: string) =>
      (await this.#write(statement, (connection) => readRows(connection, statement))).length;
    return {
      dryRun,
      expiredSnapshots: await rowsOf(steps.expire),
      deletedFiles: await rowsOf(steps.cleanup),
      deletedOrphans: await rowsOf(steps.orphans),
      compactedTables:
        steps.compact === undefined
          ? await this.#countCompactableTables()
          : await rowsOf(steps.compact),
    };
  }

  /**
   * What compaction would merge — it has no dry run — counted by the rules it follows, measured in
   * Plan C, Phase C: it merges, per table, the live files written under the same schema of that
   * table and with no deleted rows; a deletion kept in a delete file or inlined in the catalog both
   * exclude a file. The battery checks a dry run against the real one, so a DuckLake that changes
   * these rules fails there before anyone trusts a wrong count.
   */
  async #countCompactableTables(): Promise<number> {
    const filesStatement = `
      SELECT f.table_id, f.data_file_id, (
        SELECT max(v.begin_snapshot) FROM ${METADATA_CATALOG}.ducklake_schema_versions v
        WHERE v.table_id = f.table_id AND v.begin_snapshot <= f.begin_snapshot
      ) AS table_schema
      FROM ${METADATA_CATALOG}.ducklake_data_file f
      WHERE f.end_snapshot IS NULL AND NOT EXISTS (
        SELECT 1 FROM ${METADATA_CATALOG}.ducklake_delete_file d
        WHERE d.data_file_id = f.data_file_id AND d.end_snapshot IS NULL
      )`;
    const files = await this.#engine.run(filesStatement, (connection) =>
      readRows(connection, filesStatement),
    );
    const groups = new Map<string, { tableId: string; fileIds: Set<string> }>();
    for (const file of files) {
      const tableId = scalarText(file.table_id) ?? '';
      const key = `${tableId}:${scalarText(file.table_schema) ?? ''}`;
      const group = groups.get(key) ?? { tableId, fileIds: new Set<string>() };
      group.fileIds.add(scalarText(file.data_file_id) ?? '');
      groups.set(key, group);
    }
    const compactable = new Set<string>();
    for (const group of groups.values()) {
      if (group.fileIds.size < 2) {
        continue;
      }
      const inlinedDeletes = await this.#filesWithInlinedDeletes(group.tableId);
      const clean = [...group.fileIds].filter((fileId) => !inlinedDeletes.has(fileId));
      if (clean.length >= 2) {
        compactable.add(group.tableId);
      }
    }
    return compactable.size;
  }

  /** Small deletions stay in the catalog, one table per lakehouse table — when there are any. */
  async #filesWithInlinedDeletes(tableId: string): Promise<Set<string>> {
    if (!/^\d+$/.test(tableId)) {
      return new Set();
    }
    const statement = `SELECT DISTINCT file_id FROM ${METADATA_CATALOG}.ducklake_inlined_delete_${tableId}`;
    try {
      const rows = await this.#engine.run(statement, (connection) =>
        readRows(connection, statement),
      );
      return new Set(rows.map((row) => scalarText(row.file_id) ?? ''));
    } catch (error) {
      // No such table: this lakehouse table never had a deletion kept in the catalog.
      if (error instanceof LakehouseError && /does not exist|not found/i.test(error.message)) {
        return new Set();
      }
      throw error;
    }
  }

  async checkHealth(): Promise<LakehouseHealth> {
    const format = await this.#readOption('version');
    if (format !== SUPPORTED_CATALOG_FORMAT) {
      throw new LakehouseError(
        'catalog_format_mismatch',
        `The lakehouse catalog format is ${format ?? 'unknown'}; this platform reads and writes ${SUPPORTED_CATALOG_FORMAT}.`,
        {
          remedy:
            'Changing the catalog format is an explicit administrative migration (docs/01 §6.7).',
        },
      );
    }
    const persistedLimit = await this.#readOption('data_inlining_row_limit');
    const engineVersion = await this.#readScalar('SELECT version() AS value');
    const defaultLimit = await this.#readScalar(
      "SELECT current_setting('ducklake_default_data_inlining_row_limit') AS value",
    );
    return {
      lakehouseId: await requireLakehouseIdentity(this.#engine),
      catalogType: this.#engine.catalogType,
      catalogFormatVersion: format,
      engineVersion: engineVersion ?? '',
      inlining: {
        rowLimit: Number(persistedLimit ?? defaultLimit ?? INLINING_POLICY.rowLimit),
        pendingRows: await this.#countPendingInlinedRows(),
      },
    };
  }

  close(): Promise<void> {
    return this.#engine.close();
  }

  /** Writes are serialized in-process and retried only while the catalog reports a lock. */
  #write<T>(statement: string, work: (connection: DuckDBConnection) => Promise<T>): Promise<T> {
    return this.#writes.run(() => retryWhileCatalogBusy(() => this.#engine.run(statement, work)));
  }

  #readOption(name: string): Promise<string | undefined> {
    return this.#readScalar(
      `SELECT value FROM ${LAKE_ALIAS}.options() WHERE option_name = ${quoteLiteral(name)} AND scope = 'GLOBAL'`,
    );
  }

  #readScalar(statement: string): Promise<string | undefined> {
    return this.#engine.run(statement, async (connection) => {
      const [row] = await readRows(connection, statement);
      return scalarText(row?.value);
    });
  }

  // Rows kept in the catalog by data inlining and not flushed yet: live rows (no end snapshot) of
  // every inlined-data table DuckLake keeps in its metadata catalog.
  async #countPendingInlinedRows(): Promise<string> {
    const tablesStatement = `SELECT table_name FROM ${METADATA_CATALOG}.ducklake_inlined_data_tables`;
    const tables = await this.#engine.run(tablesStatement, (connection) =>
      readRows(connection, tablesStatement),
    );
    if (tables.length === 0) {
      return '0';
    }
    const countStatement = tables
      .map(
        (table) =>
          `SELECT count(*) AS live FROM ${METADATA_CATALOG}."${(scalarText(table.table_name) ?? '').replaceAll('"', '""')}" WHERE end_snapshot IS NULL`,
      )
      .join(' UNION ALL ');
    const total = await this.#readScalar(
      `SELECT coalesce(sum(live), 0) AS value FROM (${countStatement})`,
    );
    return total ?? '0';
  }
}

/**
 * DuckDB answers every data-changing statement — CREATE TABLE … AS included — with one `Count`
 * row; rowsChanged misses the CREATE … AS case, so it is only the fallback.
 */
function affectedRows(reader: DuckDBResultReader): string {
  if (reader.columnCount === 1 && reader.columnName(0) === 'Count') {
    const [row] = reader.getRowsJson();
    const count = scalarText(row?.[0]);
    if (count !== undefined) {
      return count;
    }
  }
  return String(reader.rowsChanged);
}
