import type { SecurityContext } from '../auth/security-context.ts';
import type { SemanticQuery } from './semantic-query.ts';
import type { SemanticModel, SemanticResult } from './semantic-result.ts';

/**
 * Contract version of {@link SemanticRuntimePort} (docs/21 §2), `MAJOR.MINOR`: a minor version only
 * adds (an operator, an optional field); anything a consumer could trip over is a major one.
 */
export const SEMANTIC_RUNTIME_PORT_VERSION = '1.0';

/** What the runtime can do, asked by capability — never by engine name (docs/21 §3.4). */
export interface SemanticRuntimeCapabilities {
  readonly windowFunctions: boolean;
  readonly multiStageCalculations: boolean;
  readonly preAggregations: boolean;
  readonly semanticSql: boolean;
}

export interface SemanticQueryOptions {
  /** How long the whole call may take, waiting included; the adapter's default when left out. */
  timeoutMs?: number;
}

/**
 * The governed semantic layer (docs/04, docs/21 §3): named metrics and dimensions, computed by the
 * engine, always under a security context. The caller hands over the platform's own security
 * context; how the engine receives it (groups, a signed token…) is the adapter's business.
 */
export interface SemanticRuntimePort {
  readonly capabilities: SemanticRuntimeCapabilities;
  /** The members this context may query; empty for a context without any grant. */
  describe(context: SecurityContext): Promise<SemanticModel>;
  query(
    query: SemanticQuery,
    context: SecurityContext,
    options?: SemanticQueryOptions,
  ): Promise<SemanticResult>;
}
