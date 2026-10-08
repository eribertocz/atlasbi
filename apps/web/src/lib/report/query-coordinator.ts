import type { SemanticQuery, SemanticResult } from '@atlasbi/contracts';

/** Runs one query for one visual; aborting the signal cancels the HTTP request too. */
export type QueryRunner = (query: SemanticQuery, signal: AbortSignal) => Promise<SemanticResult>;

/** A burst of clicks waits this long before anything is asked (docs/14 §1.3). */
export const QUERY_DEBOUNCE_MS = 150;

/** What a visual's request came to: its result, or nothing because a newer one replaced it. */
export type QueryOutcome = { status: 'done'; result: SemanticResult } | { status: 'superseded' };

/**
 * Between the Interaction Engine and the API (docs/14 §1.3): every visual queries through here,
 * never through the client directly. A visual's newer request cancels its older one — on the wire
 * too, one HTTP request per call (build step 6, P6-5) — and waits {@link QUERY_DEBOUNCE_MS} first.
 * No result cache yet: its key needs a fingerprint of the security context the browser does not
 * have (adjustment A6); the engine of build step 9 adds it with one from the gateway.
 */
export class QueryCoordinator {
  readonly #run: QueryRunner;
  readonly #debounceMs: number;
  readonly #pending = new Map<string, AbortController>();

  constructor(run: QueryRunner, options: { debounceMs?: number } = {}) {
    this.#run = run;
    this.#debounceMs = options.debounceMs ?? QUERY_DEBOUNCE_MS;
  }

  async query(visualId: string, query: SemanticQuery): Promise<QueryOutcome> {
    this.#pending.get(visualId)?.abort();
    const controller = new AbortController();
    this.#pending.set(visualId, controller);
    try {
      await pause(this.#debounceMs, controller.signal);
      if (controller.signal.aborted) {
        return { status: 'superseded' };
      }
      const result = await this.#run(query, controller.signal);
      return controller.signal.aborted ? { status: 'superseded' } : { status: 'done', result };
    } catch (error) {
      if (controller.signal.aborted) {
        return { status: 'superseded' };
      }
      throw error;
    } finally {
      if (this.#pending.get(visualId) === controller) {
        this.#pending.delete(visualId);
      }
    }
  }

  /** Cancels a visual's request in flight: it left the page. */
  cancel(visualId: string): void {
    this.#pending.get(visualId)?.abort();
    this.#pending.delete(visualId);
  }
}

/** Waits, or stops waiting as soon as the request is cancelled. */
function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
