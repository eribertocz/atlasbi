import {
  AccessDeniedError,
  type AccessDeniedReason,
  AuthenticationError,
  type Identity,
  type IdentityHttpHandler,
  type IdentityHttpOperation,
  type ReportDocument,
  type SecurityContext,
  type SemanticModel,
  type SemanticQuery,
  type SemanticResult,
  type SemanticRuntimePort,
} from '@atlasbi/contracts';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';

import {
  buildGatewayServer,
  type AppRouter,
  type GatewayDependencies,
} from '../../../src/index.ts';

export const PUBLIC_URL = 'http://127.0.0.1:4100';
export const ORGANIZATION = '6f1c3a52-6a47-4c39-9d43-55a1f4f0a001';
export const ANA = { userId: '0b5b8c5e-1f2a-4d0e-9a51-6f0f2f3c0001', organizationId: ORGANIZATION };
export const FINANZAS = '3d2a9f10-8c6e-4b7a-a1d2-7e5f0c9b0002';
export const COMERCIAL = '3d2a9f10-8c6e-4b7a-a1d2-7e5f0c9b0003';
/** Workspaces the fake directory denies, one per reason. */
export const DENIED: readonly (readonly [AccessDeniedReason, string])[] = [
  ['workspace_not_found', '3d2a9f10-8c6e-4b7a-a1d2-7e5f0c9b0f01'],
  ['other_organization', '3d2a9f10-8c6e-4b7a-a1d2-7e5f0c9b0f02'],
  ['not_a_member', '3d2a9f10-8c6e-4b7a-a1d2-7e5f0c9b0f03'],
];
/** The only identity token the fake identity accepts. */
export const ANA_TOKEN = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJhbmEifQ.c2lnbmF0dXJl';
export const ANA_PASSWORD = 'correct horse battery staple';

export const MODEL: SemanticModel = {
  measures: [{ name: 'sales_orders.total_amount', title: 'Total Amount', type: 'number' }],
  dimensions: [{ name: 'sales_orders.region', title: 'Region', type: 'string' }],
};

export const RESULT: SemanticResult = {
  columns: [
    { member: 'sales_orders.region', kind: 'dimension', type: 'string' },
    { member: 'sales_orders.total_amount', kind: 'measure', type: 'number' },
  ],
  rows: [['North', '1234.50']],
  rowCount: 1,
  truncated: false,
};

/** The one report the fake repository holds, in Comercial. */
export const REPORT: ReportDocument = {
  id: '9b1e6c3a-2f4d-4e8a-9c7b-1a2b3c4d0001',
  workspaceId: COMERCIAL,
  name: 'Ventas',
  schemaVersion: 1,
  pages: [
    {
      id: '9b1e6c3a-2f4d-4e8a-9c7b-1a2b3c4d0002',
      name: 'Resumen',
      visuals: [
        {
          id: '9b1e6c3a-2f4d-4e8a-9c7b-1a2b3c4d0003',
          position: { x: 0, y: 0, width: 4, height: 2 },
          spec: {
            version: 1,
            kind: 'kpi',
            measures: ['sales_orders.total_amount'],
            dimensions: [],
          },
          version: 1,
        },
      ],
    },
  ],
};

export interface FakeDependencies extends GatewayDependencies {
  semantic: FakeSemanticRuntime;
  identityHttp: FakeIdentityHttp;
}

export interface FakeSemanticRuntime extends SemanticRuntimePort {
  /** What each call received, in order. */
  calls: { method: 'describe' | 'query'; context: SecurityContext; query?: SemanticQuery }[];
  /** Thrown by the next `query` call instead of answering. */
  failNextQueryWith: Error | undefined;
}

export interface FakeIdentityHttp extends IdentityHttpHandler {
  received: { operation: IdentityHttpOperation; request: Request; body: string }[];
  /** Thrown by the next call instead of answering. */
  failNextWith: Error | undefined;
}

export function fakeDependencies(): FakeDependencies {
  const semantic: FakeSemanticRuntime = {
    capabilities: {
      windowFunctions: false,
      multiStageCalculations: true,
      preAggregations: true,
      semanticSql: false,
    },
    calls: [],
    failNextQueryWith: undefined,
    describe(context) {
      semantic.calls.push({ method: 'describe', context });
      return Promise.resolve(MODEL);
    },
    query(query, context) {
      semantic.calls.push({ method: 'query', context, query });
      const failure = semantic.failNextQueryWith;
      if (failure !== undefined) {
        semantic.failNextQueryWith = undefined;
        return Promise.reject(failure);
      }
      return Promise.resolve(RESULT);
    },
  };

  const identityHttp: FakeIdentityHttp = {
    received: [],
    failNextWith: undefined,
    async handle(operation, request) {
      const body = await request.text();
      identityHttp.received.push({ operation, request, body });
      const failure = identityHttp.failNextWith;
      if (failure !== undefined) {
        identityHttp.failNextWith = undefined;
        throw failure;
      }
      if (operation === 'sign-in') {
        const { password } = JSON.parse(body) as { password?: string };
        return password === ANA_PASSWORD
          ? json(200, {}, ['identity.session_token=session; Path=/; HttpOnly; SameSite=Lax'])
          : json(401, { code: 'invalid_credentials', message: 'Invalid email or password.' });
      }
      if (operation === 'token') {
        return request.headers.get('cookie') === 'identity.session_token=session'
          ? json(200, { token: ANA_TOKEN })
          : json(401, { code: 'session_not_found', message: 'Sign in again.' });
      }
      return json(200, {}, ['identity.session_token=; Max-Age=0; Path=/']);
    },
    close: () => Promise.resolve(),
  };

  return {
    identity: {
      verifyIdentityToken: (token) =>
        token === ANA_TOKEN
          ? Promise.resolve(ANA)
          : Promise.reject(
              new AuthenticationError('invalid_token', 'The identity token is invalid.'),
            ),
    },
    access: {
      resolveSecurityContext(identity: Identity, workspaceId: string) {
        const denied = DENIED.find(([, id]) => id === workspaceId);
        if (denied !== undefined) {
          return Promise.reject(new AccessDeniedError(denied[0]));
        }
        return Promise.resolve({
          ...identity,
          workspaceId,
          workspaceRole: 'viewer',
          entitlements: { region: { kind: 'listed', values: ['North'] } },
        });
      },
      listMemberships: () =>
        Promise.resolve([
          { workspaceId: COMERCIAL, slug: 'comercial', name: 'Comercial', role: 'admin' },
          { workspaceId: FINANZAS, slug: 'finanzas', name: 'Finanzas', role: 'viewer' },
        ]),
    },
    semantic,
    reports: {
      listReports: (workspaceId) =>
        Promise.resolve(
          workspaceId === REPORT.workspaceId ? [{ id: REPORT.id, name: REPORT.name }] : [],
        ),
      getReport: (workspaceId, reportId) =>
        Promise.resolve(
          workspaceId === REPORT.workspaceId && reportId === REPORT.id ? REPORT : undefined,
        ),
    },
    identityHttp,
    ready: () => Promise.resolve(),
  };
}

export function buildTestGateway(dependencies: GatewayDependencies): Promise<FastifyInstance> {
  return buildGatewayServer({ publicUrl: PUBLIC_URL, dependencies });
}

/** The client the frontend will use, with queries by POST, talking to the gateway in memory. */
export function trpcClient(app: FastifyInstance, authorization?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${PUBLIC_URL}/api/trpc`,
        methodOverride: 'POST',
        headers: authorization === undefined ? {} : { authorization },
        fetch: injectFetch(app),
      }),
    ],
  });
}

/** `fetch` over Fastify's in-memory injection: no port, no network. */
export function injectFetch(app: FastifyInstance) {
  return async (
    input: string | URL | Request,
    init?: { method?: string; headers?: ConstructorParameters<typeof Headers>[0]; body?: unknown },
  ): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const response = await app.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: `${url.pathname}${url.search}`,
      headers,
      ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
    });
    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined) {
          responseHeaders.append(name, String(item));
        }
      }
    }
    return new Response(response.body, { status: response.statusCode, headers: responseHeaders });
  };
}

function json(status: number, body: object, cookies: string[] = []): Response {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  for (const cookie of cookies) {
    headers.append('set-cookie', cookie);
  }
  return new Response(JSON.stringify(body), { status, headers });
}
