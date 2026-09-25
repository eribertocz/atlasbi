import { LakehouseError } from '@atlasbi/contracts';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';

import { classifyOperation } from '../../src/adapters/duckdb/statement-keyword.ts';
import { LakehouseTelemetry } from '../../src/adapters/duckdb/telemetry.ts';
import { createFakeTelemetry } from '../support/fake-telemetry.ts';

describe('classifyOperation', () => {
  it('names the operation from the first keyword only', () => {
    expect(classifyOperation("select * from t where name = 'secret'")).toBe('SELECT');
    expect(classifyOperation('  -- comment\n /* block */ (SELECT 1)')).toBe('SELECT');
    expect(classifyOperation('WITH x AS (SELECT 1) SELECT * FROM x')).toBe('SELECT');
    expect(classifyOperation('FROM lake.t')).toBe('SELECT');
    expect(classifyOperation('insert into t values (1)')).toBe('INSERT');
    expect(classifyOperation("CALL ducklake_flush_inlined_data('lake')")).toBe('CALL');
  });

  it('leaves unknown or malformed statements unnamed instead of guessing', () => {
    expect(classifyOperation('SELEC 1')).toBeUndefined();
    expect(classifyOperation('')).toBeUndefined();
    expect(classifyOperation("'literal'")).toBeUndefined();
  });
});

describe('LakehouseTelemetry', () => {
  it('records a CLIENT span and a duration with stable attributes only', async () => {
    const fake = createFakeTelemetry();
    const telemetry = new LakehouseTelemetry('postgres', fake.providers);

    await telemetry.instrument("SELECT * FROM t WHERE token = 'hunter2'", () => Promise.resolve(1));

    expect(fake.spans).toEqual([
      expect.objectContaining({
        name: 'SELECT',
        kind: SpanKind.CLIENT,
        ended: true,
        status: undefined,
        attributes: {
          'db.system.name': 'duckdb',
          'db.namespace': 'lake',
          'db.operation.name': 'SELECT',
          'lakehouse.catalog_type': 'postgres',
        },
      }),
    ]);
    expect(fake.measurements).toHaveLength(1);
    expect(fake.measurements[0]).toMatchObject({
      instrument: 'db.client.operation.duration',
      attributes: { 'db.operation.name': 'SELECT' },
    });
    expect(JSON.stringify(fake.spans)).not.toContain('hunter2');
  });

  it('marks failures with error.type = the normalized code, never the message', async () => {
    const fake = createFakeTelemetry();
    const telemetry = new LakehouseTelemetry('sqlite', fake.providers);

    await expect(
      telemetry.instrument('SELEC 1', () =>
        Promise.reject(new LakehouseError('query_failed', "near 'hunter2'")),
      ),
    ).rejects.toThrow();

    const [span] = fake.spans;
    expect(span?.name).toBe('duckdb');
    expect(span?.attributes['error.type']).toBe('query_failed');
    expect(span?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'query_failed' });
    expect(span?.exceptionsRecorded).toBe(0);
    expect(fake.measurements[0]?.attributes['error.type']).toBe('query_failed');
    expect(JSON.stringify(fake)).not.toContain('hunter2');
  });
});
