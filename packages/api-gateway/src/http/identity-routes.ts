import type { IdentityHttpHandler, IdentityHttpOperation } from '@atlasbi/contracts';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface IdentityRoutesOptions {
  handler: IdentityHttpHandler;
  /** The address the browser uses: the only Origin a POST may come from. */
  publicUrl: string;
}

/** docs/06 §6.3: every attempt per client IP; only failed ones (401) per account. */
export const SIGN_IN_LIMITS = {
  perIp: { max: 10, timeWindowMs: 60_000 },
  failuresPerAccount: { max: 5, timeWindowMs: 15 * 60_000 },
} as const;

/** A sign-in is an email and a password; nothing near this size. */
const AUTH_BODY_LIMIT = 4 * 1024;
const MAX_EMAIL_LENGTH = 320;

/**
 * The identity layer's HTTP surface (decision G4): exactly three routes, mounted under `/auth`.
 * Anything else under `/auth` is a plain 404 — none of the identity provider's other endpoints is
 * reachable (P5-2). The routes only guard and forward: the identity port answers.
 */
export async function identityRoutes(
  app: FastifyInstance,
  options: IdentityRoutesOptions,
): Promise<void> {
  await app.register(rateLimit, { global: false });
  // Two checkers, one preHandler: a second `rateLimit()` on one route never runs (P5-10).
  const perIp = app.createRateLimit({
    max: SIGN_IN_LIMITS.perIp.max,
    timeWindow: SIGN_IN_LIMITS.perIp.timeWindowMs,
    keyGenerator: (request) => `ip:${request.ip}`,
  });
  const failuresPerAccount = app.createRateLimit({
    max: SIGN_IN_LIMITS.failuresPerAccount.max,
    timeWindow: SIGN_IN_LIMITS.failuresPerAccount.timeWindowMs,
    keyGenerator: (request) => `account:${accountOf(request) ?? ''}`,
  });

  /** A browser always sends Origin on a POST; its absence is no reason to trust the request. */
  const sameOriginOnly = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.origin !== options.publicUrl) {
      return reply.code(403).send({
        code: 'forbidden_origin',
        message: 'This request does not come from the platform.',
      });
    }
  };

  app.post(
    '/sign-in/email',
    {
      bodyLimit: AUTH_BODY_LIMIT,
      onRequest: sameOriginOnly,
      preHandler: async (request, reply) => {
        const ip = await perIp(request);
        const account =
          accountOf(request) === undefined
            ? undefined
            : await failuresPerAccount(request, { increment: false });
        const ipExceeded = !ip.isAllowed && ip.isExceeded;
        const accountLocked =
          account !== undefined && !account.isAllowed && account.remaining === 0;
        if (ipExceeded || accountLocked) {
          // Neither which limit nor when it ends: nothing tells whether an account is targeted.
          return reply.code(429).send({
            code: 'too_many_requests',
            message: 'Too many attempts. Try again later.',
          });
        }
      },
      onSend: async (request, reply, payload) => {
        // Checked before the attempt, counted after it: a correct password costs nothing.
        if (reply.statusCode === 401 && accountOf(request) !== undefined) {
          await failuresPerAccount(request);
        }
        return payload;
      },
    },
    forward(options.handler, 'sign-in', options.publicUrl),
  );
  app.post(
    '/sign-out',
    { bodyLimit: AUTH_BODY_LIMIT, onRequest: sameOriginOnly },
    forward(options.handler, 'sign-out', options.publicUrl),
  );
  app.get('/token', forward(options.handler, 'token', options.publicUrl));
}

/** The account a sign-in names, normalized as the identity layer compares it. */
function accountOf(request: FastifyRequest): string | undefined {
  const email = (request.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' && email.length <= MAX_EMAIL_LENGTH
    ? email.trim().toLowerCase()
    : undefined;
}

function forward(handler: IdentityHttpHandler, operation: IdentityHttpOperation, origin: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const response = await handler.handle(operation, toWebRequest(request, origin));
    reply.code(response.status);
    for (const [name, value] of response.headers) {
      if (name !== 'set-cookie') {
        reply.header(name, value);
      }
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) {
      reply.header('set-cookie', cookies);
    }
    return reply.send(await response.text());
  };
}

/** Describe the connection, not the request; the body is re-serialized, so its length changes. */
const CONNECTION_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
]);

/** Fastify has already parsed (and size-limited) the body; the port takes a web Request. */
function toWebRequest(request: FastifyRequest, origin: string): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (CONNECTION_HEADERS.has(name)) {
      continue;
    }
    if (typeof value === 'string') {
      headers.set(name, value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    }
  }
  const body =
    request.body === undefined
      ? undefined
      : typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body);
  return new Request(`${origin}${request.url}`, {
    method: request.method,
    headers,
    ...(body === undefined || request.method === 'GET' ? {} : { body }),
  });
}
