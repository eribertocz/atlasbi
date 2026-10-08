import type { WatchedProcess } from '../system/watched-process.ts';
import type { ReadinessStep } from './readiness-chain.ts';
import { retryUntil, type RetryPolicy } from './retry-until.ts';

export const WEB_STEP = 'Web';

/** Vite's command line, relative to the web app's folder: run by Node, no shell in between. */
export const WEB_DEV_SERVER = { cwd: 'apps/web', script: 'node_modules/vite/bin/vite.js' };

class WebFailedToStartError extends Error {
  constructor(reason: string) {
    super(`it failed to start: ${reason}`);
    this.name = 'WebFailedToStartError';
  }
}

// The first page compiles on demand under Vite; a failed start is seen at once in its output.
const WEB_READY: RetryPolicy = {
  timeoutMs: 60_000,
  intervalMs: 250,
  isRetryable: (error) => !(error instanceof WebFailedToStartError),
};

export interface WebStep {
  step: ReadinessStep;
  /** The process the step started, when it runs one (`pnpm dev`). */
  started: () => WatchedProcess | undefined;
}

/**
 * The browser's single origin (docs/19 §10), last in the chain (docs/19 §9: … → API Gateway →
 * Web). Ready means it serves the app and reaches the gateway through /auth — not merely that a
 * process listens. Under `pnpm dev` it starts Vite first; under `stack:up` the proxy's container
 * is already running.
 */
export function webReadinessStep(options: {
  port: number;
  dependsOn: readonly string[];
  start?: () => WatchedProcess;
  timing?: Pick<RetryPolicy, 'timeoutMs' | 'intervalMs'>;
}): WebStep {
  let started: WatchedProcess | undefined;
  const url = `http://127.0.0.1:${options.port}`;
  return {
    started: () => started,
    step: {
      name: WEB_STEP,
      dependsOn: options.dependsOn,
      ensureReady: async () => {
        started = options.start?.();
        await retryUntil(() => probeWeb(url, started), { ...WEB_READY, ...options.timing });
        return `healthy — ${url}`;
      },
    },
  };
}

export async function probeWeb(url: string, server: WatchedProcess | undefined): Promise<void> {
  if (server?.failedToStart() === true) {
    throw new WebFailedToStartError(server.failureReason());
  }
  const page = await answer(`${url}/`);
  if (!page.ok || !(page.headers.get('content-type') ?? '').startsWith('text/html')) {
    throw new Error(`the app answered HTTP ${page.status} on ${new URL(url).host}`);
  }
  // Without a session the gateway answers 401: only the gateway does, through this origin.
  const identity = await answer(`${url}/auth/token`);
  if (identity.status !== 401) {
    throw new Error(
      `the origin does not reach the API gateway: /auth/token answered HTTP ${identity.status}`,
    );
  }
}

async function answer(url: string): Promise<Response> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    throw new Error(`no answer on ${new URL(url).host}${cause ? ` (${cause})` : ''}`, {
      cause: error,
    });
  }
}
