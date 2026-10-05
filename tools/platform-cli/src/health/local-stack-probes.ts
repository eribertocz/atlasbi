import {
  checkDatabaseConnection,
  DatabaseUnavailableError,
  listPendingMigrations,
  migrateToLatest,
} from '@atlasbi/database';

import type { LocalInfraPorts } from '../local-environment.ts';
import type { ReadinessStep } from './readiness-chain.ts';
import { retryUntil, type RetryPolicy } from './retry-until.ts';

// A first start runs initdb inside the container, which takes a while on a Podman VM — but a
// wrong password or a missing database fails at once instead of waiting out the timeout.
const POSTGRES_READY: RetryPolicy = {
  timeoutMs: 90_000,
  intervalMs: 1_000,
  isRetryable: (error) => !(error instanceof DatabaseUnavailableError) || error.retryable,
};
const COLLECTOR_READY: RetryPolicy = { timeoutMs: 30_000, intervalMs: 1_000 };

export const MIGRATIONS_STEP = 'Migrations';

export function localStackReadinessSteps(
  databaseUrl: string,
  ports: LocalInfraPorts,
): ReadinessStep[] {
  return [
    {
      name: 'Postgres',
      ensureReady: async () => {
        await retryUntil(() => checkDatabaseConnection(databaseUrl), POSTGRES_READY);
        return 'healthy';
      },
    },
    {
      name: MIGRATIONS_STEP,
      dependsOn: ['Postgres'],
      ensureReady: async () => {
        const { applied } = await migrateToLatest({ connectionString: databaseUrl });
        const pending = await listPendingMigrations({ connectionString: databaseUrl });
        if (pending.length > 0) {
          throw new Error(`still pending after migrating: ${pending.join(', ')}`);
        }
        return applied.length === 0 ? 'up to date' : `applied ${applied.join(', ')}`;
      },
    },
    {
      name: 'OTel Collector',
      ensureReady: async () => {
        await retryUntil(() => checkCollectorHealth(ports.otelHealth), COLLECTOR_READY);
        return 'healthy';
      },
    },
  ];
}

async function checkCollectorHealth(port: number): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2_000) });
  } catch (error) {
    // fetch reports every network failure as "fetch failed"; the useful part is the cause code.
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    throw new Error(`no answer on 127.0.0.1:${port}${cause ? ` (${cause})` : ''}`, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new Error(`health_check extension answered HTTP ${response.status}`);
  }
}
