import { describe, expect, it } from 'vitest';

import { runReadinessChain, type ReadinessStep } from '../../src/health/readiness-chain.ts';

const ready = (name: string, dependsOn?: string[]): ReadinessStep => ({
  name,
  ...(dependsOn ? { dependsOn } : {}),
  ensureReady: () => Promise.resolve('healthy'),
});

const failing = (name: string, reason: string): ReadinessStep => ({
  name,
  ensureReady: () => Promise.reject(new Error(reason)),
});

describe('runReadinessChain', () => {
  it('is ready when every step is ready', async () => {
    const report = await runReadinessChain([ready('Postgres'), ready('Migrations', ['Postgres'])]);

    expect(report.ready).toBe(true);
    expect(report.outcomes.map((outcome) => outcome.status)).toEqual(['ready', 'ready']);
  });

  it('skips dependents of a failed step but still checks independent ones', async () => {
    const report = await runReadinessChain([
      failing('Postgres', 'Database is not reachable: ECONNREFUSED'),
      ready('Migrations', ['Postgres']),
      ready('OTel Collector'),
    ]);

    expect(report.ready).toBe(false);
    expect(report.outcomes).toEqual([
      { name: 'Postgres', status: 'failed', detail: 'Database is not reachable: ECONNREFUSED' },
      { name: 'Migrations', status: 'skipped', detail: 'waits for Postgres' },
      { name: 'OTel Collector', status: 'ready', detail: 'healthy' },
    ]);
  });

  it('propagates a skip through transitive dependencies', async () => {
    const report = await runReadinessChain([
      failing('Postgres', 'down'),
      ready('Migrations', ['Postgres']),
      ready('Cube', ['Migrations']),
    ]);

    expect(report.outcomes[2]).toEqual({
      name: 'Cube',
      status: 'skipped',
      detail: 'waits for Migrations',
    });
  });
});
