import {
  createNoopMeter,
  type Attributes,
  type Histogram,
  type MeterProvider,
  type Span,
  type SpanKind,
  type SpanOptions,
  type SpanStatus,
  type Tracer,
  type TracerProvider,
} from '@opentelemetry/api';

import type { TelemetryProviders } from '../../src/index.ts';

export interface RecordedSpan {
  name: string;
  kind: SpanKind | undefined;
  attributes: Attributes;
  status: SpanStatus | undefined;
  ended: boolean;
  exceptionsRecorded: number;
  events: number;
}

export interface RecordedMeasurement {
  instrument: string;
  value: number;
  attributes: Attributes;
}

export interface FakeTelemetry {
  providers: Required<TelemetryProviders>;
  spans: RecordedSpan[];
  measurements: RecordedMeasurement[];
}

/** Records what the adapter emits, written against the OTel API only — no SDK is involved. */
export function createFakeTelemetry(): FakeTelemetry {
  const spans: RecordedSpan[] = [];
  const measurements: RecordedMeasurement[] = [];

  const startSpan = (name: string, options: SpanOptions = {}): Span => {
    const recorded: RecordedSpan = {
      name,
      kind: options.kind,
      attributes: { ...options.attributes },
      status: undefined,
      ended: false,
      exceptionsRecorded: 0,
      events: 0,
    };
    spans.push(recorded);
    const span: Span = {
      spanContext: () => ({ traceId: '1'.repeat(32), spanId: '1'.repeat(16), traceFlags: 1 }),
      setAttribute: (key, value) => {
        recorded.attributes[key] = value;
        return span;
      },
      setAttributes: (attributes) => {
        Object.assign(recorded.attributes, attributes);
        return span;
      },
      addEvent: () => {
        recorded.events += 1;
        return span;
      },
      addLink: () => span,
      addLinks: () => span,
      setStatus: (status) => {
        recorded.status = status;
        return span;
      },
      updateName: (newName) => {
        recorded.name = newName;
        return span;
      },
      end: () => {
        recorded.ended = true;
      },
      isRecording: () => true,
      recordException: () => {
        recorded.exceptionsRecorded += 1;
      },
    };
    return span;
  };
  const tracer = {
    startSpan,
    startActiveSpan: () => {
      throw new Error('The lakehouse adapter is expected to use startSpan only.');
    },
  } as unknown as Tracer;
  const tracerProvider: TracerProvider = { getTracer: () => tracer };

  const meter = createNoopMeter();
  meter.createHistogram = (instrument: string): Histogram => ({
    record: (value: number, attributes: Attributes = {}) => {
      measurements.push({ instrument, value, attributes });
    },
  });
  const meterProvider: MeterProvider = { getMeter: () => meter };

  return { providers: { tracerProvider, meterProvider }, spans, measurements };
}
