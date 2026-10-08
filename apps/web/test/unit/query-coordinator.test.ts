import type { SemanticQuery, SemanticResult } from '@atlasbi/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QUERY_DEBOUNCE_MS, QueryCoordinator } from '../../src/lib/report/query-coordinator.ts';

const result = (label: string): SemanticResult => ({
  columns: [{ member: 'sales_orders.total_amount', kind: 'measure', type: 'number' }],
  rows: [[label]],
  rowCount: 1,
  truncated: false,
});
const query = (region: string): SemanticQuery => ({
  measures: ['sales_orders.total_amount'],
  filters: [{ member: 'sales_orders.region', operator: 'equals', values: [region] }],
});

/** A gateway that answers each query after `latency` ms, unless its request is aborted first. */
function gateway(latency: number) {
  const asked: string[] = [];
  const aborted: string[] = [];
  const run = (asking: SemanticQuery, signal: AbortSignal) => {
    const region = asking.filters?.[0]?.values[0] ?? 'all';
    asked.push(region);
    return new Promise<SemanticResult>((resolve, reject) => {
      const timer = setTimeout(() => resolve(result(region)), latency);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        aborted.push(region);
        reject(new Error('aborted'));
      });
    });
  };
  return { run, asked, aborted };
}

describe('the query coordinator (docs/14 §1.3, first cut)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it(`waits ${QUERY_DEBOUNCE_MS} ms, so a burst of clicks asks once`, async () => {
    const { run, asked } = gateway(10);
    const coordinator = new QueryCoordinator(run);

    const outcomes = [
      coordinator.query('kpi', query('North')),
      coordinator.query('kpi', query('South')),
      coordinator.query('kpi', query('East')),
    ];
    await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS + 10);

    expect(await Promise.all(outcomes)).toEqual([
      { status: 'superseded' },
      { status: 'superseded' },
      { status: 'done', result: result('East') },
    ]);
    expect(asked).toEqual(['East']);
  });

  it('cancels a visual’s request in flight when it asks again — on the wire, not just the answer', async () => {
    const { run, asked, aborted } = gateway(500);
    const coordinator = new QueryCoordinator(run);

    const first = coordinator.query('kpi', query('North'));
    await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS + 100);
    const second = coordinator.query('kpi', query('South'));
    await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS + 500);

    await expect(first).resolves.toEqual({ status: 'superseded' });
    await expect(second).resolves.toEqual({ status: 'done', result: result('South') });
    expect(asked).toEqual(['North', 'South']);
    expect(aborted).toEqual(['North']);
  });

  it('keeps each visual’s requests apart', async () => {
    const { run, asked } = gateway(10);
    const coordinator = new QueryCoordinator(run);

    const kpi = coordinator.query('kpi', query('North'));
    const line = coordinator.query('line', query('North'));
    await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS + 10);

    expect((await kpi).status).toBe('done');
    expect((await line).status).toBe('done');
    expect(asked).toEqual(['North', 'North']);
  });

  it('cancels a visual that leaves the page, and passes on a real failure', async () => {
    const coordinator = new QueryCoordinator(() => Promise.reject(new Error('unavailable')));

    const leaving = coordinator.query('kpi', query('North'));
    coordinator.cancel('kpi');
    const failing = coordinator.query('line', query('North'));
    const failure = expect(failing).rejects.toThrow('unavailable');
    await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS);

    await expect(leaving).resolves.toEqual({ status: 'superseded' });
    await failure;
  });
});
