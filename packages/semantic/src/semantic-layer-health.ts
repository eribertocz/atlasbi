import { signQueryToken } from './query-token.ts';

export class SemanticLayerUnavailableError extends Error {
  readonly remedy: string | undefined;
  /** False when waiting cannot help — Cube rejects the platform's token. */
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { remedy?: string; cause?: unknown; retryable?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'SemanticLayerUnavailableError';
    this.remedy = options.remedy;
    this.retryable = options.retryable ?? true;
  }
}

export interface SemanticLayerEndpoint {
  /** e.g. http://127.0.0.1:4000 */
  url: string;
  apiSecret: string;
}

const TIMEOUT_MS = 10_000;
const CONTINUE_WAIT_ATTEMPTS = 20;
// Not covered by any pre-aggregation, and it reads a column's values from the lakehouse's storage.
const PROBE_QUERY = { dimensions: ['regions.zone'], limit: 1 };

/**
 * Cube is healthy when it can answer from the lakehouse, not merely when it runs. `/readyz` alone
 * misses a wrong storage key (the ATTACH never touches the storage), and a query served by a
 * pre-aggregation misses a lakehouse that is gone (build step 3, Phase 0, P3-9). So: `/readyz`, then
 * a query that has to read the data itself.
 */
export async function probeSemanticLayer(endpoint: SemanticLayerEndpoint): Promise<void> {
  const readyz = await request(`${endpoint.url}/readyz`, {});
  if (!readyz.ok) {
    throw new SemanticLayerUnavailableError(
      `Cube reports it is not ready (HTTP ${readyz.status})`,
      {
        remedy: 'The Cube logs say why: `pnpm stack:logs`.',
      },
    );
  }
  const token = signQueryToken(endpoint.apiSecret, { sub: 'platform-health' });
  const url = `${endpoint.url}/cubejs-api/v1/load?query=${encodeURIComponent(JSON.stringify(PROBE_QUERY))}`;
  for (let attempt = 0; attempt < CONTINUE_WAIT_ATTEMPTS; attempt++) {
    const response = await request(url, { authorization: token });
    const body = (await response.json().catch(() => ({}))) as { error?: unknown; data?: unknown };
    if (body.error === 'Continue wait') {
      continue;
    }
    if (!response.ok || !Array.isArray(body.data)) {
      throw new SemanticLayerUnavailableError(
        `Cube cannot answer from the lakehouse: ${typeof body.error === 'string' ? body.error : `HTTP ${response.status}`}`,
        {
          retryable: response.status !== 403,
          remedy:
            response.status === 403
              ? 'Check semantic.api-secret (ATLASBI_SEMANTIC_API_SECRET): Cube and the platform must share it.'
              : 'The Cube logs say why: `pnpm stack:logs`.',
        },
      );
    }
    return;
  }
  throw new SemanticLayerUnavailableError('Cube kept the probe query waiting', {
    remedy: 'The Cube logs say why: `pnpm stack:logs`.',
  });
}

async function request(url: string, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    throw new SemanticLayerUnavailableError(
      `no answer from Cube at ${new URL(url).host}${cause ? ` (${cause})` : ''}`,
      { cause: error, remedy: 'Start the local stack with `pnpm dev`.' },
    );
  }
}
