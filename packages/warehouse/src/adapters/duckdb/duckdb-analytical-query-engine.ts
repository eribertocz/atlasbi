import {
  DEFAULT_QUERY_MAX_ROWS,
  LakehouseError,
  type AnalyticalQueryCapabilities,
  type AnalyticalQueryPort,
  type QueryOptions,
  type QueryParameter,
  type QueryResult,
} from '@atlasbi/contracts';
import type { DuckDBConnection } from '@duckdb/node-api';

import type { LakehouseEngine } from './lakehouse-engine.ts';
import { prepareSingleStatement } from './statement-guard.ts';
import { bindParameters, toQueryResult } from './value-encoding.ts';

/** AnalyticalQueryPort over a read-only, hardened DuckDB instance (docs/01 §6.7). */
export class DuckDBAnalyticalQueryEngine implements AnalyticalQueryPort {
  readonly capabilities: AnalyticalQueryCapabilities = {
    sqlDialect: 'duckdb',
    positionalParameters: true,
    timeouts: true,
  };
  readonly #engine: LakehouseEngine;

  constructor(engine: LakehouseEngine) {
    this.#engine = engine;
  }

  query(
    statement: string,
    parameters: readonly QueryParameter[] = [],
    options: QueryOptions = {},
  ): Promise<QueryResult> {
    const maxRows = options.maxRows ?? DEFAULT_QUERY_MAX_ROWS;
    if (!Number.isSafeInteger(maxRows) || maxRows < 0) {
      return Promise.reject(
        new LakehouseError('query_failed', 'maxRows must be a non-negative integer.'),
      );
    }
    return this.#engine.run(statement, async (connection) => {
      const prepared = await prepareSingleStatement(connection, statement, 'read');
      bindParameters(prepared, parameters);
      // Streaming stops after the first chunks that reach maxRows + 1: the rest is never read.
      const reader = await withTimeout(connection, options.timeoutMs, () =>
        prepared.streamAndReadUntil(maxRows + 1),
      );
      return toQueryResult(reader, maxRows);
    });
  }

  close(): Promise<void> {
    return this.#engine.close();
  }
}

async function withTimeout<T>(
  connection: DuckDBConnection,
  timeoutMs: number | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (timeoutMs === undefined) {
    return run();
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    connection.interrupt();
  }, timeoutMs);
  try {
    return await run();
  } catch (error) {
    if (timedOut) {
      // Same code as a failed statement, but unlike a syntax error it may succeed on a later try.
      throw new LakehouseError(
        'query_failed',
        `The query exceeded its ${timeoutMs} ms time limit and was cancelled.`,
        { retryable: true },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
