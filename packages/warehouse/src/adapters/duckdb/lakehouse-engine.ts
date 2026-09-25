import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';

import { LakehouseError, type LakehouseCatalogType } from '@atlasbi/contracts';

import type { LakehouseSettings } from '../../lakehouse-settings.ts';
import type { LakehouseAccess } from './attach-statement.ts';
import { openLakehouseConnection } from './connection-initializer.ts';
import { toLakehouseError } from './error-mapper.ts';
import { openLakehouseInstance } from './instance-initializer.ts';
import { LakehouseTelemetry, type TelemetryProviders } from './telemetry.ts';

/**
 * One embedded DuckDB instance with the lakehouse attached, shared by both port adapters.
 * Every statement gets its own connection, span and normalized error; nothing of DuckDB escapes.
 */
export class LakehouseEngine {
  readonly catalogType: LakehouseCatalogType;
  #instance: DuckDBInstance | undefined;
  readonly #telemetry: LakehouseTelemetry;
  readonly #activeConnections = new Set<DuckDBConnection>();

  private constructor(
    instance: DuckDBInstance,
    catalogType: LakehouseCatalogType,
    telemetry: LakehouseTelemetry,
  ) {
    this.#instance = instance;
    this.catalogType = catalogType;
    this.#telemetry = telemetry;
  }

  static async open(
    settings: LakehouseSettings,
    access: LakehouseAccess,
    telemetry: TelemetryProviders = {},
  ): Promise<LakehouseEngine> {
    const instance = await openLakehouseInstance(settings, access);
    return new LakehouseEngine(
      instance,
      settings.catalog.type,
      new LakehouseTelemetry(settings.catalog.type, telemetry),
    );
  }

  /** Runs `work` on a fresh connection; `sql` is the statement it runs, used only to classify the span. */
  async run<T>(sql: string, work: (connection: DuckDBConnection) => Promise<T>): Promise<T> {
    const instance = this.#requireOpen();
    return this.#telemetry.instrument(sql, async () => {
      let connection: DuckDBConnection | undefined;
      try {
        connection = await openLakehouseConnection(instance);
        this.#activeConnections.add(connection);
        return await work(connection);
      } catch (error) {
        throw this.#instance === undefined
          ? new LakehouseError(
              'engine_closed',
              'The lakehouse engine was closed while the statement ran.',
            )
          : toLakehouseError(error);
      } finally {
        if (connection !== undefined) {
          this.#activeConnections.delete(connection);
          closeQuietly(connection);
        }
      }
    });
  }

  /** Cancels running statements and releases the instance; idempotent. */
  close(): Promise<void> {
    const instance = this.#instance;
    this.#instance = undefined;
    if (instance !== undefined) {
      for (const connection of this.#activeConnections) {
        connection.interrupt();
      }
      instance.closeSync();
    }
    return Promise.resolve();
  }

  #requireOpen(): DuckDBInstance {
    if (this.#instance === undefined) {
      throw new LakehouseError('engine_closed', 'The lakehouse engine is closed.');
    }
    return this.#instance;
  }
}

function closeQuietly(connection: DuckDBConnection): void {
  try {
    connection.closeSync();
  } catch {
    // Already released together with its instance.
  }
}
