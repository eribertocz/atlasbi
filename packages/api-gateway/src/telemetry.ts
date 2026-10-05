import { FastifyOtelInstrumentation } from '@fastify/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_URL_FULL,
  ATTR_URL_PATH,
  ATTR_URL_QUERY,
} from '@opentelemetry/semantic-conventions';

/** Neutral on purpose: the codename never goes into telemetry (docs/21 §1). */
export const SERVICE_NAME = 'api-gateway';

export interface TelemetryOptions {
  /** The OTLP/HTTP endpoint of the collector (OTEL_EXPORTER_OTLP_ENDPOINT). */
  otlpEndpoint: string;
  /** Replaces the OTLP export — tests read spans from memory instead. */
  spanProcessors?: SpanProcessor[];
}

export interface GatewayTelemetry {
  /** Flushes what is still buffered. */
  shutdown(): Promise<void>;
}

/**
 * Traces of the gateway (build step 5, decision G8): its HTTP requests (@fastify/otel), its queries
 * to the platform database (pg: the parameterized text, never the values) and its calls to Cube
 * (undici). Must run before Fastify and pg are loaded — `main.ts` imports the server afterwards.
 *
 * - The query string never reaches a span: @fastify/otel puts the whole URL in `url.path` (P5-8),
 *   and undici records `url.full` and `url.query` of every outgoing call. Cube's client sends
 *   nothing in a URL today; this keeps it that way in the traces whatever a later call does.
 * - No propagator: a client's `traceparent` is ignored, so nobody outside chooses which trace a
 *   request joins; and none is sent to Cube, which exports no traces of its own.
 */
export function startTelemetry(options: TelemetryOptions): GatewayTelemetry {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME }),
    spanProcessors: options.spanProcessors ?? [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${options.otlpEndpoint}/v1/traces` })),
    ],
  });
  provider.register({ propagator: null });
  const unregister = registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      new FastifyOtelInstrumentation({
        registerOnInitialization: true,
        requestHook: (span, request) => {
          span.setAttribute(ATTR_URL_PATH, withoutQuery(request.url));
        },
      }),
      new PgInstrumentation(),
      new UndiciInstrumentation({
        startSpanHook: (request) => ({
          [ATTR_URL_FULL]: `${request.origin}${withoutQuery(request.path)}`,
          [ATTR_URL_QUERY]: undefined,
        }),
      }),
    ],
  });

  return {
    async shutdown() {
      unregister();
      await provider.shutdown();
    },
  };
}

function withoutQuery(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}
