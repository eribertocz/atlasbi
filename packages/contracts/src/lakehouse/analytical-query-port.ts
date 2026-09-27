import type { QueryParameter, QueryResult } from './query-result.ts';

/**
 * Contract version of {@link AnalyticalQueryPort} (docs/21 §2), `MAJOR.MINOR`: a minor version only
 * adds (an error code, an optional field); anything a consumer could trip over is a major one.
 * 1.1 added the `storage_unreachable` error code.
 */
export const ANALYTICAL_QUERY_PORT_VERSION = '1.1';

/** Rows returned when a caller does not set `maxRows`. */
export const DEFAULT_QUERY_MAX_ROWS = 10_000;

export interface QueryOptions {
  /** Defaults to {@link DEFAULT_QUERY_MAX_ROWS}; extra rows are not read and `truncated` is set. */
  maxRows?: number;
  /**
   * Cancels the statement once exceeded; the call rejects with `query_failed` and
   * `retryable: true` — unlike an invalid statement, which is `query_failed`, not retryable.
   */
  timeoutMs?: number;
}

export interface AnalyticalQueryCapabilities {
  /** SQL dialect `query` accepts — a future SQL Lab uses it for syntax support. */
  readonly sqlDialect: string;
  readonly positionalParameters: boolean;
  readonly timeouts: boolean;
}

/**
 * Read-only access to the lakehouse (docs/01 §7): health checks, readers and the future SQL Lab.
 * Exactly one `SELECT` per call; anything else rejects with `read_only_violation` without running.
 * There is deliberately no `execute` — writing goes through `LakehouseAdminPort`.
 */
export interface AnalyticalQueryPort {
  readonly capabilities: AnalyticalQueryCapabilities;
  query(
    statement: string,
    parameters?: readonly QueryParameter[],
    options?: QueryOptions,
  ): Promise<QueryResult>;
  /** Releases the engine; later calls reject with `engine_closed`. Safe to call twice. */
  close(): Promise<void>;
}
