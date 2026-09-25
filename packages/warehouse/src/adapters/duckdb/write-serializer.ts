import { setTimeout as delay } from 'node:timers/promises';

import { LakehouseError } from '@atlasbi/contracts';

import { SINGLE_WRITER_REMEDY, toLakehouseError } from './error-mapper.ts';

/**
 * Runs writes one at a time within this process. With a SQLite catalog two concurrent writers can
 * lock each other out until the process restarts (docs/01 §6.6); in-process serialization always
 * held in Phase 0, so this adapter never races itself.
 */
export class WriteSerializer {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(task);
    this.#tail = result.catch(() => undefined);
    return result;
  }
}

export interface CatalogBusyRetryPolicy {
  attempts: number;
  initialDelayMs: number;
  backoffFactor: number;
}

/** Each locked attempt already waits several seconds inside the engine; three bound it to well under a minute. */
export const CATALOG_BUSY_RETRY: CatalogBusyRetryPolicy = {
  attempts: 3,
  initialDelayMs: 250,
  backoffFactor: 2,
};

/**
 * Retries only `catalog_busy`, within a fixed budget. When the budget runs out the lock is not
 * transient — another process holds the catalog — so the error says so and stops being retryable.
 */
export async function retryWhileCatalogBusy<T>(
  operation: () => Promise<T>,
  policy: CatalogBusyRetryPolicy = CATALOG_BUSY_RETRY,
): Promise<T> {
  let wait = policy.initialDelayMs;
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const mapped = toLakehouseError(error);
      if (mapped.code !== 'catalog_busy') {
        throw mapped;
      }
      if (attempt >= policy.attempts) {
        throw new LakehouseError(
          'catalog_busy',
          `The SQLite lakehouse catalog stayed locked after ${policy.attempts} attempts: another process is writing to it.`,
          { retryable: false, remedy: SINGLE_WRITER_REMEDY },
        );
      }
      await delay(wait);
      wait *= policy.backoffFactor;
    }
  }
}
