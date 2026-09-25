import {
  LakehouseError,
  type ExecuteResult,
  type FlushResult,
  type LakehouseAdminCapabilities,
  type LakehouseAdminPort,
  type LakehouseHealth,
  type QueryParameter,
} from '@atlasbi/contracts';
import type { DuckDBConnection, DuckDBResultReader } from '@duckdb/node-api';

import { INLINING_POLICY, SUPPORTED_CATALOG_FORMAT } from '../../lakehouse-policies.ts';
import { LAKE_ALIAS } from './attach-statement.ts';
import { readRows, scalarText } from './internal-reads.ts';
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
