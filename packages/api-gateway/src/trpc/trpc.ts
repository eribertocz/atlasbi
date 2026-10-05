import {
  AccessDeniedError,
  AuthenticationError,
  SemanticRuntimeError,
  type SemanticRuntimeErrorCode,
} from '@atlasbi/contracts';
import { initTRPC, TRPCError } from '@trpc/server';
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';
import { z } from 'zod';

/** What every procedure receives: the request's credential, nothing verified yet. */
export interface RequestContext {
  /** The `Authorization` header as sent; procedures verify it, nobody logs it. */
  authorization: string | undefined;
}

/** A field the input validation rejected: where, and which rule — never the value. */
export interface InputIssue {
  path: string;
  code: string;
}

export const INTERNAL_ERROR_MESSAGE = 'Internal error';
const INVALID_INPUT_MESSAGE = 'Invalid input';

/**
 * tRPC hardened (build step 5, adjustment 4; P5-7):
 * - `isDev: false` always — otherwise tRPC sends the stack whenever NODE_ENV is not production;
 * - an internal error answers "Internal error": tRPC's default sends the original message, even in
 *   production, and it can name hosts, files or SQL;
 * - an invalid input answers with the rejected fields and rules, never zod's messages (they can
 *   repeat the input);
 * - no stack and no procedure path in any answer.
 */
const t = initTRPC.context<RequestContext>().create({
  isDev: false,
  errorFormatter({ shape, error }) {
    const issues = error.cause instanceof z.ZodError ? toInputIssues(error.cause) : undefined;
    return {
      code: shape.code,
      message:
        error.code === 'INTERNAL_SERVER_ERROR'
          ? INTERNAL_ERROR_MESSAGE
          : issues === undefined
            ? shape.message
            : INVALID_INPUT_MESSAGE,
      data: {
        code: shape.data.code,
        httpStatus: shape.data.httpStatus,
        ...(issues === undefined ? {} : { issues }),
      },
    };
  },
});

export const router = t.router;

/**
 * The platform's errors as tRPC codes, translated in one place. Messages stay the platform's own:
 * the same one for every reason access is denied, nothing an engine wrote.
 */
const domainErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const translated = translateDomainError(result.error.cause);
    if (translated !== undefined) {
      throw translated;
    }
  }
  return result;
});

export const publicProcedure = t.procedure.use(domainErrors);

export function translateDomainError(error: unknown): TRPCError | undefined {
  if (error instanceof AuthenticationError) {
    return new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in again.', cause: error });
  }
  if (error instanceof AccessDeniedError) {
    return new TRPCError({ code: 'FORBIDDEN', message: error.message, cause: error });
  }
  if (error instanceof SemanticRuntimeError) {
    return new TRPCError({
      code: semanticErrorCode(error.code),
      message: error.message,
      cause: error,
    });
  }
  return undefined;
}

function semanticErrorCode(code: SemanticRuntimeErrorCode): TRPC_ERROR_CODE_KEY {
  switch (code) {
    case 'invalid_query':
      return 'BAD_REQUEST';
    case 'unknown_member':
      return 'NOT_FOUND';
    case 'unavailable':
      return 'SERVICE_UNAVAILABLE';
    case 'query_failed':
      return 'INTERNAL_SERVER_ERROR';
  }
}

function toInputIssues(error: z.ZodError): InputIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
  }));
}
