import type { IdentityHttpHandler } from '@atlasbi/contracts';
import helmet from '@fastify/helmet';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyInstance } from 'fastify';

import { identityRoutes } from './http/identity-routes.ts';
import { createAppRouter, type AppRouter, type RouterServices } from './trpc/app-router.ts';
import type { RequestContext } from './trpc/trpc.ts';

export interface GatewayDependencies extends RouterServices {
  identityHttp: IdentityHttpHandler;
  /** Resolves when the gateway can serve: the platform database answers. */
  ready(): Promise<void>;
}

export interface GatewayServerOptions {
  /** The address the browser uses (ATLASBI_PUBLIC_URL), as an origin. */
  publicUrl: string;
  dependencies: GatewayDependencies;
}

export const TRPC_PREFIX = '/api/trpc';
/** Bodies above this are refused before any parsing (adjustment 4). */
export const BODY_LIMIT = 1024 * 1024;
/** tRPC batches no more calls than this in one request (adjustment 4). */
export const MAX_BATCH_SIZE = 10;
/** Room per batched procedure name in the URL, comma included; ours are far shorter. */
const MAX_PROCEDURE_PATH_LENGTH = 100;
const READY_TIMEOUT_MS = 2_000;

/**
 * The single entry point of the browser (docs/06 §1.1): `/auth` (identity), `/api/trpc` (the
 * internal BFF), `/health` and `/ready`. `/api/v1` stays reserved for the public API (decision G5).
 * No CORS: the browser reaches it from the platform's own origin only (docs/19 §10).
 */
export async function buildGatewayServer(options: GatewayServerOptions): Promise<FastifyInstance> {
  const { dependencies } = options;
  const app = Fastify({
    logger: false,
    bodyLimit: BODY_LIMIT,
    return503OnClosing: true,
    // tRPC carries a batch's procedure names in one path parameter, comma-separated: Fastify's
    // default of 100 characters answers 414 to ten calls of `session.me`.
    routerOptions: { maxParamLength: MAX_BATCH_SIZE * MAX_PROCEDURE_PATH_LENGTH },
  });

  // A JSON API: nothing in an answer is a document to render, frame or run.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (!reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-store');
    }
    return payload;
  });

  // Fastify's own answers repeat the URL, and a 500 carries the error's message: neither leaves.
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ code: 'not_found', message: 'Not found.' }),
  );
  app.setErrorHandler((error: { statusCode?: number }, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      reportInternalError(
        `${request.method} ${request.routeOptions.url ?? 'unknown route'}`,
        error,
      );
      return reply.code(500).send({ code: 'internal_error', message: 'Internal error.' });
    }
    return reply.code(status).send(clientError(status));
  });

  await app.register(identityRoutes, {
    prefix: '/auth',
    handler: dependencies.identityHttp,
    publicUrl: options.publicUrl,
  });

  app.get('/health', { config: { otel: false } }, () => ({ status: 'ok' }));
  app.get('/ready', { config: { otel: false } }, async (request, reply) => {
    try {
      await withTimeout(dependencies.ready(), READY_TIMEOUT_MS);
      return { status: 'ready' };
    } catch {
      // Which dependency failed is for the logs of that dependency, not for anyone asking.
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  await app.register(async (api) => {
    // Queries go by POST too (the client sets `methodOverride: 'POST'`): input in a URL ends up
    // in logs and spans (P5-7, P5-8). No subscriptions either.
    api.addHook('onRequest', async (request, reply) => {
      if (request.method !== 'POST') {
        return reply
          .code(405)
          .header('allow', 'POST')
          .send({ code: 'method_not_allowed', message: 'Use POST.' });
      }
    });
    const trpcOptions: FastifyTRPCPluginOptions<AppRouter>['trpcOptions'] = {
      router: createAppRouter(dependencies),
      createContext: ({ req }): RequestContext => ({ authorization: req.headers.authorization }),
      allowMethodOverride: true,
      maxBatchSize: MAX_BATCH_SIZE,
      onError: ({ error, path }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          reportInternalError(path ?? 'unknown procedure', error.cause ?? error);
        }
      },
    };
    await api.register(fastifyTRPCPlugin, { prefix: TRPC_PREFIX, trpcOptions });
  });

  return app;
}

function clientError(status: number): { code: string; message: string } {
  switch (status) {
    case 413:
      return { code: 'payload_too_large', message: 'The request is too large.' };
    case 415:
      return { code: 'unsupported_media_type', message: 'Send JSON.' };
    default:
      return { code: 'invalid_request', message: 'The request could not be read.' };
  }
}

/** The operator's side of an "Internal error": the client got nothing of it. */
function reportInternalError(where: string, error: unknown): void {
  console.error(`api-gateway: ${where} failed:`, error);
}

async function withTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
