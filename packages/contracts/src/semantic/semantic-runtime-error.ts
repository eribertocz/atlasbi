export const SEMANTIC_RUNTIME_ERROR_CODES = [
  /** The query is malformed: shape, operator, values, dates, order or limit. */
  'invalid_query',
  /**
   * A member that does not exist, or that this security context may not use — deliberately
   * indistinguishable, so a query cannot probe what someone is not allowed to see.
   */
  'unknown_member',
  /** The semantic layer, or what it reads, does not answer in time. */
  'unavailable',
  /** The engine rejected a query that passed validation. */
  'query_failed',
] as const;

export type SemanticRuntimeErrorCode = (typeof SEMANTIC_RUNTIME_ERROR_CODES)[number];

/**
 * The only error the semantic runtime port rejects with. The engine's own messages never cross the
 * adapter (docs/21 §3.2): they name tables, files and hosts. The engine logs them.
 */
export class SemanticRuntimeError extends Error {
  readonly code: SemanticRuntimeErrorCode;
  /** True when trying again later may succeed without changing the query. */
  readonly retryable: boolean;

  constructor(
    code: SemanticRuntimeErrorCode,
    message: string,
    options: { retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'SemanticRuntimeError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}
