import { setTimeout as delay } from 'node:timers/promises';

export interface RetryPolicy {
  timeoutMs: number;
  intervalMs: number;
  /** Failures for which this returns false are rethrown at once — waiting cannot fix them. */
  isRetryable?: (error: unknown) => boolean;
}

/** Retries until `attempt` succeeds; after the timeout, rethrows the last failure. */
export async function retryUntil<T>(attempt: () => Promise<T>, policy: RetryPolicy): Promise<T> {
  const deadline = Date.now() + policy.timeoutMs;
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      const retryable = policy.isRetryable?.(error) ?? true;
      if (!retryable || Date.now() + policy.intervalMs > deadline) {
        throw error;
      }
      await delay(policy.intervalMs);
    }
  }
}
