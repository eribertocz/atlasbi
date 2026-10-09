import { describe, expect, it } from 'vitest';

import {
  exitCodeFor,
  INGEST_ERROR_CODES,
  INGEST_EXIT_CODES,
  InvalidIngestSummaryError,
  parseIngestSummary,
} from '../../src/index.ts';

const SUCCEEDED = {
  jobVersion: '1.0',
  source: 'github',
  status: 'succeeded',
  exitCode: 0,
  retryable: false,
  startedAt: '2026-10-07T12:00:00Z',
  finishedAt: '2026-10-07T12:00:09Z',
  loads: [
    { entity: 'repo_events', partition: 'duckdb/duckdb', loadId: '1791421789.18932', rows: 4 },
  ],
  landing: [
    { table: { schema: 'landing_github', name: 'repo_events' }, rowsAdded: 4, rowsTotal: 599 },
  ],
};

const failedWith = (code: string, exitCode: number) => ({
  ...SUCCEEDED,
  status: 'failed',
  exitCode,
  retryable: exitCode === 75,
  loads: [],
  landing: [],
  error: { code, message: 'The source did not answer.' },
});

describe('the ingestion job contract', () => {
  it('accepts a successful run and a failed one', () => {
    expect(parseIngestSummary(SUCCEEDED)).toEqual(SUCCEEDED);
    expect(parseIngestSummary(failedWith('source_unavailable', 75))).toMatchObject({
      retryable: true,
      error: { code: 'source_unavailable' },
    });
  });

  it('retries only what can work unchanged', () => {
    const retryable = INGEST_ERROR_CODES.filter(
      (code) => exitCodeFor(code) === INGEST_EXIT_CODES.retryable,
    );
    expect(retryable).toEqual(['source_unavailable', 'catalog_unavailable', 'storage_unavailable']);
    expect(exitCodeFor('credentials_refused')).toBe(77);
    expect(exitCodeFor('schema_change')).toBe(65);
    expect(exitCodeFor('configuration_error')).toBe(78);
  });

  it('refuses a summary whose parts disagree', () => {
    for (const summary of [
      { ...SUCCEEDED, exitCode: 75 },
      { ...SUCCEEDED, retryable: true },
      failedWith('credentials_refused', 75),
      { ...failedWith('source_unavailable', 75), error: undefined },
      { ...SUCCEEDED, error: { code: 'internal_error', message: 'x' } },
      { ...SUCCEEDED, jobVersion: '2.0' },
      { ...SUCCEEDED, exitCode: 1 },
      { ...SUCCEEDED, loads: [{ entity: 'repo_events', partition: 'x', loadId: 1, rows: 4 }] },
      failedWith('disk_full', 70),
    ]) {
      expect(() => parseIngestSummary(summary)).toThrow(InvalidIngestSummaryError);
    }
  });
});
