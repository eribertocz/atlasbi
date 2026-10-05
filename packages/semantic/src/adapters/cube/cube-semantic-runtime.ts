import type {
  SecurityContext,
  SemanticRuntimeCapabilities,
  SemanticRuntimePort,
} from '@atlasbi/contracts';

import { toQueryClaims } from '../../query-claims.ts';
import { signQueryToken } from '../../query-token.ts';
import { createCubeClient } from './cube-client.ts';
import { toCubeQuery } from './cube-query.ts';
import { parseSemanticQuery, resolveAgainstModel } from './query-validation.ts';
import { toSemanticModel, toSemanticResult } from './result-mapping.ts';

export interface CubeSemanticRuntimeOptions {
  /** Cube's REST address, e.g. http://127.0.0.1:4000 */
  url: string;
  /** The secret Cube verifies query tokens with (semantic.api-secret). */
  apiSecret: string;
  /** Default time a call may take, "Continue wait" included. 30 s when left out. */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** Well inside the query token's life (≤ 300 s), which `queryRewrite` checks on every query. */
const MAX_TIMEOUT_MS = 120_000;

/**
 * Cube's capabilities as the port offers them in v1: SemanticQuery has no window functions and no
 * SQL; the model's multi-stage measures (time shift) and its pre-aggregations work through it.
 */
const CAPABILITIES: SemanticRuntimeCapabilities = Object.freeze({
  windowFunctions: false,
  multiStageCalculations: true,
  preAggregations: true,
  semanticSql: false,
});

/**
 * The semantic runtime over Cube (docs/21 §3): the only place that knows Cube's query format,
 * its metadata and its errors. Per call it signs a short query token from the platform's security
 * context (build step 4), reads what that context may use, validates the query against it, and
 * only then asks for data.
 */
export function createCubeSemanticRuntime(
  options: CubeSemanticRuntimeOptions,
): SemanticRuntimePort {
  const client = createCubeClient({
    url: options.url,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const deadline = (timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS) =>
    Date.now() + Math.min(Math.max(timeoutMs, 1), MAX_TIMEOUT_MS);
  const tokenFor = (context: SecurityContext) =>
    signQueryToken(options.apiSecret, toQueryClaims(context));

  return {
    capabilities: CAPABILITIES,

    async describe(context) {
      return toSemanticModel(await client.meta(tokenFor(context), deadline()));
    },

    async query(input, context, queryOptions = {}) {
      const until = deadline(queryOptions.timeoutMs);
      const query = parseSemanticQuery(input);
      const token = tokenFor(context);
      const model = toSemanticModel(await client.meta(token, until));
      const resolved = resolveAgainstModel(query, model);
      const records = await client.load(token, toCubeQuery(resolved), until);
      return toSemanticResult(resolved, records);
    },
  };
}
