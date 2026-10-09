import {
  SEMANTIC_REFRESH_JOB_VERSION,
  type SemanticRefreshBuild,
  type SemanticRefreshErrorCode,
  semanticRefreshExitCodeFor,
  type SemanticRefreshSummary,
} from '@atlasbi/contracts';

import { signJobToken } from './query-token.ts';

export interface SemanticRefreshTarget {
  /** The semantic layer's REST address, as the platform reaches it (config.semantic.url). */
  url: string;
  /** semantic.api-secret: the secret the layer verifies the platform's tokens with. */
  apiSecret: string;
}

export interface SemanticRefreshOptions {
  /** How long the builds may take before the job gives up, retryable. Default: 10 minutes. */
  timeoutMs?: number;
  pollMs?: number;
}

const JOBS_PATH = '/cubejs-api/v1/pre-aggregations/jobs';

class RefreshStopped extends Error {
  readonly code: SemanticRefreshErrorCode;

  constructor(code: SemanticRefreshErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Rebuilds every precomputed result of the semantic layer (Plan C) and waits for it: run after
 * transformation published new data, so the layer never answers from an older build. Asks with a
 * job token, which may run these jobs and nothing else — no data, no metadata (decision C3).
 */
export async function refreshSemanticLayer(
  target: SemanticRefreshTarget,
  options: SemanticRefreshOptions = {},
): Promise<SemanticRefreshSummary> {
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + (options.timeoutMs ?? 600_000);
  try {
    // Every precomputed result, for the platform's own context: building is Cube's own work.
    const tokens = await jobs<unknown>(target, {
      action: 'post',
      selector: { contexts: [{ securityContext: {} }], timezones: ['UTC'] },
    });
    if (!Array.isArray(tokens) || !tokens.every((token) => typeof token === 'string')) {
      throw new RefreshStopped(
        'internal_error',
        'The semantic layer answered the refresh with something else than its job list.',
      );
    }
    const builds = await waitForBuilds(target, tokens, deadline, options.pollMs ?? 500);
    const failed = builds.filter((build) => build.status === 'failed');
    if (failed.length > 0) {
      throw new RefreshStopped(
        'build_failed',
        `The semantic layer could not build ${failed.map((build) => build.name).join(', ')}; its log says why.`,
      );
    }
    return summary(startedAt, builds);
  } catch (error) {
    if (error instanceof RefreshStopped) {
      return summary(startedAt, [], { code: error.code, message: error.message });
    }
    throw error;
  }
}

async function waitForBuilds(
  target: SemanticRefreshTarget,
  tokens: string[],
  deadline: number,
  pollMs: number,
): Promise<SemanticRefreshBuild[]> {
  if (tokens.length === 0) {
    return [];
  }
  for (;;) {
    const states = await jobs<
      Record<string, { status?: unknown; selector?: unknown; table?: unknown }>
    >(target, { action: 'get', resType: 'object', tokens });
    const entries = tokens.map((token) => states[token]);
    const pending = entries.some(
      (entry) =>
        entry === undefined || entry.status === 'scheduled' || entry.status === 'processing',
    );
    if (!pending) {
      return mergeByName(entries.map((entry) => toBuild(entry ?? {})));
    }
    if (Date.now() > deadline) {
      throw new RefreshStopped(
        'semantic_unavailable',
        'The semantic layer did not finish its builds in time; try again later.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

function toBuild(entry: {
  status?: unknown;
  selector?: unknown;
  table?: unknown;
}): SemanticRefreshBuild {
  const selector = entry.selector as { preAggregations?: unknown } | undefined;
  const named: unknown = Array.isArray(selector?.preAggregations)
    ? (selector.preAggregations as unknown[])[0]
    : undefined;
  const name =
    typeof named === 'string' ? named : typeof entry.table === 'string' ? entry.table : 'unknown';
  return { name, status: entry.status === 'done' ? 'built' : 'failed' };
}

/** One entry per precomputed result: its partitions fail together, or it is built. */
function mergeByName(builds: SemanticRefreshBuild[]): SemanticRefreshBuild[] {
  const merged = new Map<string, SemanticRefreshBuild>();
  for (const build of builds) {
    const known = merged.get(build.name);
    merged.set(build.name, known?.status === 'failed' ? known : build);
  }
  return [...merged.values()];
}

async function jobs<Answer>(target: SemanticRefreshTarget, body: object): Promise<Answer> {
  let response: Response;
  try {
    response = await fetch(`${target.url}${JOBS_PATH}`, {
      method: 'POST',
      // A fresh token per call: a long build outlives any one short-lived token.
      headers: {
        authorization: signJobToken(target.apiSecret),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new RefreshStopped(
      'semantic_unavailable',
      'The semantic layer did not answer; try again later.',
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new RefreshStopped(
      'credentials_refused',
      "The semantic layer refused the platform's job token: semantic.api-secret differs from the one it verifies with, or it does not grant the jobs scope.",
    );
  }
  if (response.status >= 500) {
    throw new RefreshStopped(
      'semantic_unavailable',
      `The semantic layer failed to answer (HTTP ${response.status}); try again later.`,
    );
  }
  if (!response.ok) {
    throw new RefreshStopped(
      'internal_error',
      `The semantic layer refused the refresh (HTTP ${response.status}).`,
    );
  }
  return (await response.json()) as Answer;
}

function summary(
  startedAt: string,
  builds: readonly SemanticRefreshBuild[],
  error?: { code: SemanticRefreshErrorCode; message: string },
): SemanticRefreshSummary {
  const exitCode = error === undefined ? 0 : semanticRefreshExitCodeFor(error.code);
  return {
    jobVersion: SEMANTIC_REFRESH_JOB_VERSION,
    status: error === undefined ? 'succeeded' : 'failed',
    exitCode,
    retryable: exitCode === 75,
    startedAt,
    finishedAt: new Date().toISOString(),
    builds,
    ...(error === undefined ? {} : { error }),
  };
}

/** A refresh that failed before it could ask — no semantic layer on this tier, a missing secret. */
export function semanticRefreshFailure(
  startedAt: string,
  error: { code: SemanticRefreshErrorCode; message: string },
): SemanticRefreshSummary {
  return summary(startedAt, [], error);
}
