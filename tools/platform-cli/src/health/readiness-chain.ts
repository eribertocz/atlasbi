export interface ReadinessStep {
  name: string;
  /** Steps that must be ready first (docs/19 §9: Postgres → migrations → Cube → API → Web). */
  dependsOn?: readonly string[];
  /** Resolves with a short status detail once the piece can take traffic; rejects otherwise. */
  ensureReady(): Promise<string>;
}

export type ReadinessStatus = 'ready' | 'failed' | 'skipped';

export interface ReadinessOutcome {
  name: string;
  status: ReadinessStatus;
  detail: string;
}

export interface ReadinessReport {
  ready: boolean;
  outcomes: ReadinessOutcome[];
}

/**
 * Runs the steps in order. A step whose dependency is not ready is skipped instead of producing a
 * confusing downstream error; independent steps still report their own state.
 */
export async function runReadinessChain(steps: readonly ReadinessStep[]): Promise<ReadinessReport> {
  const notReady = new Set<string>();
  const outcomes: ReadinessOutcome[] = [];

  for (const step of steps) {
    const blockedBy = step.dependsOn?.find((dependency) => notReady.has(dependency));
    if (blockedBy !== undefined) {
      notReady.add(step.name);
      outcomes.push({ name: step.name, status: 'skipped', detail: `waits for ${blockedBy}` });
      continue;
    }
    try {
      outcomes.push({ name: step.name, status: 'ready', detail: await step.ensureReady() });
    } catch (error) {
      notReady.add(step.name);
      outcomes.push({
        name: step.name,
        status: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ready: notReady.size === 0, outcomes };
}
