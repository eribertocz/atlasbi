import type { CubeMeta, CubeQuery, CubeRecord } from './cube-api.ts';
import { notInTime, toSemanticRuntimeError, unreachable } from './error-mapping.ts';

export interface CubeClient {
  meta(token: string, deadline: number): Promise<CubeMeta>;
  /** Waits through "Continue wait" until the data arrives or the deadline passes. */
  load(token: string, query: CubeQuery, deadline: number): Promise<CubeRecord[]>;
}

const API = '/cubejs-api/v1';

/**
 * Two calls of Cube's REST API over `fetch` (decision G10). The query token travels in the
 * Authorization header — never in a URL, so it stays out of logs and spans (P5-8).
 */
export function createCubeClient(options: {
  url: string;
  fetch?: typeof globalThis.fetch;
}): CubeClient {
  const base = options.url.replace(/\/+$/, '');
  const fetchFn = options.fetch ?? globalThis.fetch;

  async function send(
    path: string,
    init: { method: 'GET' | 'POST'; token: string; body?: string },
    deadline: number,
  ): Promise<{ status: number; body: unknown }> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw notInTime();
    }
    const signal = AbortSignal.timeout(remaining);
    try {
      const response = await fetchFn(`${base}${API}${path}`, {
        method: init.method,
        headers: {
          authorization: init.token,
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: init.body }),
        signal,
      });
      const text = await response.text();
      return { status: response.status, body: parseJson(text) };
    } catch {
      throw signal.aborted ? notInTime() : unreachable();
    }
  }

  return {
    async meta(token, deadline) {
      const { status, body } = await send('/meta', { method: 'GET', token }, deadline);
      if (status === 200 && isRecord(body) && Array.isArray(body.cubes)) {
        return body;
      }
      throw toSemanticRuntimeError(status, errorOf(body));
    },

    async load(token, query, deadline) {
      const body = JSON.stringify({ query });
      for (;;) {
        const answer = await send('/load', { method: 'POST', token, body }, deadline);
        const error = errorOf(answer.body);
        if (error === 'Continue wait') {
          continue;
        }
        if (
          answer.status === 200 &&
          error === undefined &&
          isRecord(answer.body) &&
          Array.isArray(answer.body.data)
        ) {
          return answer.body.data as CubeRecord[];
        }
        throw toSemanticRuntimeError(answer.status, error);
      }
    },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorOf(body: unknown): unknown {
  return isRecord(body) ? body.error : undefined;
}
