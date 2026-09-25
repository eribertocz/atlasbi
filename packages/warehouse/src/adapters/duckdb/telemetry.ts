import type { LakehouseCatalogType } from '@atlasbi/contracts';
import { LakehouseError } from '@atlasbi/contracts';
import {
  metrics,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Histogram,
  type MeterProvider,
  type Tracer,
  type TracerProvider,
} from '@opentelemetry/api';
import {
  ATTR_DB_NAMESPACE,
  ATTR_DB_OPERATION_NAME,
  ATTR_DB_SYSTEM_NAME,
  ATTR_ERROR_TYPE,
  METRIC_DB_CLIENT_OPERATION_DURATION,
} from '@opentelemetry/semantic-conventions';

import { LAKE_ALIAS } from './attach-statement.ts';
import { classifyOperation } from './statement-keyword.ts';

/** Platform attribute: which catalog database served the operation. */
export const ATTR_LAKEHOUSE_CATALOG_TYPE = 'lakehouse.catalog_type';

// DuckDB is not among the spec's well-known values; the conventions allow a custom one.
const DB_SYSTEM_NAME = 'duckdb';
const INSTRUMENTATION_SCOPE = '@atlasbi/warehouse';
// Bucket boundaries the stable database conventions recommend for this histogram.
const DURATION_BUCKETS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10];

export interface TelemetryProviders {
  tracerProvider?: TracerProvider;
  meterProvider?: MeterProvider;
}

/**
 * One CLIENT span and one duration measurement per statement, with stable semantic conventions
 * only (docs/11 §4.6). Never recorded: the statement text, parameter values, engine messages —
 * they can repeat literals — or anything about credentials.
 */
export class LakehouseTelemetry {
  readonly #tracer: Tracer;
  readonly #duration: Histogram;
  readonly #baseAttributes: Attributes;

  constructor(catalogType: LakehouseCatalogType, providers: TelemetryProviders = {}) {
    this.#tracer = (providers.tracerProvider ?? trace.getTracerProvider()).getTracer(
      INSTRUMENTATION_SCOPE,
    );
    this.#duration = (providers.meterProvider ?? metrics.getMeterProvider())
      .getMeter(INSTRUMENTATION_SCOPE)
      .createHistogram(METRIC_DB_CLIENT_OPERATION_DURATION, {
        unit: 's',
        description: 'Duration of lakehouse client operations.',
        advice: { explicitBucketBoundaries: DURATION_BUCKETS },
      });
    this.#baseAttributes = {
      [ATTR_DB_SYSTEM_NAME]: DB_SYSTEM_NAME,
      [ATTR_DB_NAMESPACE]: LAKE_ALIAS,
      [ATTR_LAKEHOUSE_CATALOG_TYPE]: catalogType,
    };
  }

  async instrument<T>(sql: string, operation: () => Promise<T>): Promise<T> {
    const operationName = classifyOperation(sql);
    const attributes: Attributes = {
      ...this.#baseAttributes,
      ...(operationName === undefined ? {} : { [ATTR_DB_OPERATION_NAME]: operationName }),
    };
    const span = this.#tracer.startSpan(operationName ?? DB_SYSTEM_NAME, {
      kind: SpanKind.CLIENT,
      attributes,
    });
    const started = performance.now();
    try {
      return await operation();
    } catch (error) {
      const errorType = error instanceof LakehouseError ? error.code : 'query_failed';
      span.setAttribute(ATTR_ERROR_TYPE, errorType);
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorType });
      attributes[ATTR_ERROR_TYPE] = errorType;
      throw error;
    } finally {
      this.#duration.record((performance.now() - started) / 1000, attributes);
      span.end();
    }
  }
}
