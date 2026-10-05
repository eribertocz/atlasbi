import { SemanticRuntimeError } from '@atlasbi/contracts';

// Cube's words, recognized here and never repeated: they name tables, files, hosts and model
// internals (build step 5, Phase 0, P5-6). Cube logs the originals with their request id.

/** cube/lakehouse-connection.cjs: every lakehouse failure, already stripped of internals. */
const LAKEHOUSE_UNAVAILABLE = 'The lakehouse is unavailable to the semantic layer';
/** cube/query-security.cjs `EXPIRED`: the query token died while Cube was still working. */
const TOKEN_EXPIRED = 'The query token has expired, or it is not short-lived';
/** Cube's answer to a member the security context may not use, or that is not public. */
const HIDDEN_MEMBER = /You requested hidden member/;
/** Cube's answer to a member or cube that does not exist. */
const NOT_FOUND = /not found for path/;
const LIMIT_EXCEEDED = /query limit has been exceeded/;

/** One message for "does not exist" and "not yours to see", so neither can be told apart. */
export const UNKNOWN_MEMBER_MESSAGE =
  'The query uses a member that does not exist or that is not available.';

export function unknownMember(): SemanticRuntimeError {
  return new SemanticRuntimeError('unknown_member', UNKNOWN_MEMBER_MESSAGE);
}

export function invalidQuery(reason: string): SemanticRuntimeError {
  return new SemanticRuntimeError('invalid_query', `Invalid query: ${reason}.`);
}

export function notInTime(): SemanticRuntimeError {
  return new SemanticRuntimeError('unavailable', 'The semantic layer did not answer in time.', {
    retryable: true,
  });
}

export function unreachable(): SemanticRuntimeError {
  return new SemanticRuntimeError('unavailable', 'The semantic layer cannot be reached.', {
    retryable: true,
  });
}

/** Translates a Cube answer that is not data into the port's error; never keeps Cube's text. */
export function toSemanticRuntimeError(status: number, cubeError: unknown): SemanticRuntimeError {
  const message = typeof cubeError === 'string' ? cubeError : '';
  if (message.includes(LAKEHOUSE_UNAVAILABLE)) {
    return new SemanticRuntimeError(
      'unavailable',
      'The data behind the semantic layer is unavailable.',
      { retryable: true },
    );
  }
  if (message.includes(TOKEN_EXPIRED)) {
    return notInTime();
  }
  if (status === 401 || status === 403) {
    // Cube refuses the platform's own signature: a deployment mistake, not something to retry.
    return new SemanticRuntimeError(
      'unavailable',
      "The semantic layer refuses the platform's credentials.",
    );
  }
  if (HIDDEN_MEMBER.test(message) || NOT_FOUND.test(message)) {
    return unknownMember();
  }
  if (LIMIT_EXCEEDED.test(message)) {
    return invalidQuery('the limit is too high');
  }
  if (status === 502 || status === 503 || status === 504) {
    return unreachable();
  }
  if (status >= 400 && status < 500) {
    return invalidQuery('the semantic layer cannot run it');
  }
  return new SemanticRuntimeError('query_failed', 'The semantic layer could not answer the query.');
}
