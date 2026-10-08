import type { WatchedProcess } from '../system/watched-process.ts';
import type { ReadinessStep } from './readiness-chain.ts';
import { retryUntil, type RetryPolicy } from './retry-until.ts';

export const GATEWAY_STEP = 'API Gateway';

/** The gateway's entry point, relative to the workspace root. */
export const GATEWAY_SCRIPT = 'packages/api-gateway/src/main.ts';

class GatewayFailedToStartError extends Error {
  constructor(reason: string) {
    super(`it failed to start: ${reason}`);
    this.name = 'GatewayFailedToStartError';
  }
}

// It answers in a second or two; a failure at startup is seen at once in its output.
const GATEWAY_READY: RetryPolicy = {
  timeoutMs: 30_000,
  intervalMs: 250,
  isRetryable: (error) => !(error instanceof GatewayFailedToStartError),
};

export interface GatewayStep {
  step: ReadinessStep;
  /** The process the step started, once it ran. */
  started: () => WatchedProcess | undefined;
}

/**
 * Starts the API gateway and waits for `/ready` (docs/19 §9: … → Cube → API Gateway → Web). Ready
 * means it answers and the platform database answers it, not merely that the process runs.
 */
export function gatewayReadinessStep(options: {
  port: number;
  dependsOn: readonly string[];
  start: () => WatchedProcess;
  /** How long to wait, and how often to ask; a failed start always ends the wait at once. */
  timing?: Pick<RetryPolicy, 'timeoutMs' | 'intervalMs'>;
}): GatewayStep {
  let started: WatchedProcess | undefined;
  const url = `http://127.0.0.1:${options.port}`;
  return {
    started: () => started,
    step: {
      name: GATEWAY_STEP,
      dependsOn: options.dependsOn,
      ensureReady: async () => {
        const gateway = options.start();
        started = gateway;
        await retryUntil(() => probeGateway(url, gateway), { ...GATEWAY_READY, ...options.timing });
        return `healthy — ${url}`;
      },
    },
  };
}

export async function probeGateway(url: string, gateway: WatchedProcess): Promise<void> {
  if (gateway.failedToStart()) {
    throw new GatewayFailedToStartError(gateway.failureReason());
  }
  let response: Response;
  try {
    response = await fetch(`${url}/ready`, { signal: AbortSignal.timeout(2_000) });
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    throw new Error(`no answer on ${new URL(url).host}${cause ? ` (${cause})` : ''}`, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new Error(
      `/ready answered HTTP ${response.status}: the platform database does not answer it`,
    );
  }
}

/** Asks the gateway's own `/ready` from inside its container, where it listens. */
export const GATEWAY_CONTAINER_PROBE = [
  'node',
  '-e',
  "fetch('http://127.0.0.1:4100/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))",
] as const;

/**
 * The gateway's container under `pnpm stack:up`: it publishes no port — the browser reaches it
 * through Web — so its readiness is asked inside the container, the same `/ready` as the process's.
 */
export function gatewayContainerReadinessStep(options: {
  dependsOn: readonly string[];
  /** True once `/ready` answers 200 inside the container. */
  isReady: () => Promise<boolean>;
  timing?: Pick<RetryPolicy, 'timeoutMs' | 'intervalMs'>;
}): ReadinessStep {
  return {
    name: GATEWAY_STEP,
    dependsOn: options.dependsOn,
    ensureReady: async () => {
      await retryUntil(
        async () => {
          if (!(await options.isReady())) {
            throw new Error('/ready does not answer 200 inside its container');
          }
        },
        { timeoutMs: 60_000, intervalMs: 500, ...options.timing },
      );
      return 'healthy — in its container, reached through Web';
    },
  };
}
