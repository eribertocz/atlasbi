import { describe, expect, it } from 'vitest';

import {
  INGEST_ERROR_CODES,
  JOB_EXIT_CODES,
  jobErrorForLakehouseFailure,
  LakehouseError,
  parseSemanticRefreshSummary,
  parseTransformSummary,
  SEMANTIC_REFRESH_ERROR_CODES,
  semanticRefreshExitCodeFor,
  SHARED_JOB_ERROR_CODES,
  TRANSFORM_ERROR_CODES,
  transformExitCodeFor,
} from '../../src/index.ts';

const NOW = '2026-10-08T12:00:00Z';
const succeeded = {
  jobVersion: '1.0',
  verb: 'run',
  status: 'succeeded',
  exitCode: 0,
  retryable: false,
  startedAt: NOW,
  finishedAt: NOW,
  models: [
    {
      model: 'marts.mart_sales_orders',
      intervals: 1,
      durationMs: 89,
      auditsPassed: 3,
      auditsFailed: 0,
      failed: false,
    },
  ],
};

describe('what every job shares', () => {
  it('gives every job the shared error codes, with the same exit codes', () => {
    for (const codes of [INGEST_ERROR_CODES, TRANSFORM_ERROR_CODES, SEMANTIC_REFRESH_ERROR_CODES]) {
      expect(codes).toEqual(expect.arrayContaining([...SHARED_JOB_ERROR_CODES]));
    }
    expect(transformExitCodeFor('catalog_unavailable')).toBe(JOB_EXIT_CODES.retryable);
    expect(transformExitCodeFor('credentials_refused')).toBe(JOB_EXIT_CODES.credentialsRefused);
  });

  it('turns a lakehouse that does not open into the job error a caller can act on', () => {
    const outcome = (error: LakehouseError) => jobErrorForLakehouseFailure(error).code;

    expect(outcome(new LakehouseError('catalog_unreachable', 'down', { retryable: true }))).toBe(
      'catalog_unavailable',
    );
    expect(
      outcome(new LakehouseError('catalog_unreachable', 'password authentication failed')),
    ).toBe('credentials_refused');
    expect(
      outcome(new LakehouseError('storage_unreachable', 'the storage refused the request')),
    ).toBe('credentials_refused');
    expect(outcome(new LakehouseError('catalog_busy', 'busy'))).toBe('catalog_unavailable');
    expect(outcome(new LakehouseError('data_path_mismatch', 'elsewhere'))).toBe(
      'configuration_error',
    );
  });
});

describe('the transformation job contract', () => {
  it('accepts a summary as the runner prints it', () => {
    expect(parseTransformSummary(succeeded)).toEqual(succeeded);
    expect(
      parseTransformSummary({
        ...succeeded,
        verb: 'check',
        models: [],
        lint: [{ rule: 'NoIngestionInternals', model: 'staging.stg_x' }],
        audits: { passed: true },
      }).lint,
    ).toEqual([{ rule: 'NoIngestionInternals', model: 'staging.stg_x' }]);
  });

  it('maps each failure of its own to a data error, but an unanswering state to a retry', () => {
    for (const code of ['model_invalid', 'model_failed', 'audit_failed', 'test_failed'] as const) {
      expect(transformExitCodeFor(code), code).toBe(JOB_EXIT_CODES.dataError);
    }
    expect(transformExitCodeFor('state_unavailable')).toBe(JOB_EXIT_CODES.retryable);
  });

  it('names an unknown verb only when that was the mistake (usage_error)', () => {
    const usage = {
      ...succeeded,
      verb: 'plan',
      status: 'failed',
      exitCode: 64,
      models: [],
      error: { code: 'usage_error', message: 'Usage: …' },
    };

    expect(parseTransformSummary(usage).verb).toBe('plan');
  });

  it('refuses a summary whose verb, codes or shapes do not agree', () => {
    const failed = { ...succeeded, status: 'failed', models: [] };
    for (const bad of [
      { ...succeeded, verb: 'plan' },
      { ...failed, exitCode: 65, error: { code: 'state_unavailable', message: 'x' } },
      {
        ...failed,
        exitCode: 75,
        retryable: false,
        error: { code: 'state_unavailable', message: 'x' },
      },
      { ...succeeded, models: [{ model: 'm' }] },
      { ...succeeded, tests: { run: -1, failed: 0 } },
    ]) {
      expect(() => parseTransformSummary(bad), JSON.stringify(bad)).toThrow(
        /Invalid transformation summary/,
      );
    }
  });
});

describe('the semantic refresh job contract', () => {
  const built = {
    jobVersion: '1.0',
    status: 'succeeded',
    exitCode: 0,
    retryable: false,
    startedAt: NOW,
    finishedAt: NOW,
    builds: [{ name: 'sales_orders.amount_by_region_month', status: 'built' }],
  };

  it('accepts what was rebuilt, and maps an unanswering layer to a retry', () => {
    expect(parseSemanticRefreshSummary(built)).toEqual(built);
    expect(semanticRefreshExitCodeFor('semantic_unavailable')).toBe(JOB_EXIT_CODES.retryable);
    expect(semanticRefreshExitCodeFor('build_failed')).toBe(JOB_EXIT_CODES.dataError);
  });

  it('refuses a build with another status', () => {
    expect(() =>
      parseSemanticRefreshSummary({ ...built, builds: [{ name: 'x', status: 'scheduled' }] }),
    ).toThrow(/Invalid semantic refresh summary/);
  });
});
