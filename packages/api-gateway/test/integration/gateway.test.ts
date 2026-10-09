import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import type {
  Identity,
  IdentityHttpHandler,
  IdentityPort,
  SemanticRuntimePort,
} from '@atlasbi/contracts';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AppRouter } from '../../src/index.ts';
import { type GatewayTelemetry, startTelemetry } from '../../src/telemetry.ts';

const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../.env', import.meta.url));
/** The Origin the gateway trusts; the server itself listens on a free port. */
const PUBLIC_URL = 'http://127.0.0.1:4100';
const PASSWORD = 'correct horse battery staple';
const TOTAL_BY_REGION = {
  measures: ['sales_orders.total_amount'],
  dimensions: ['sales_orders.region'],
};

// The whole chain over real HTTP (build step 5): identity (better-auth) and authorization on a
// throwaway platform database, the semantic runtime against the development Cube — `pnpm dev`
// must run, on the postgres tier. Telemetry starts first and keeps every span in memory (P5-8).
describe('the API gateway, end to end', () => {
  const spans = new InMemorySpanExporter();
  let telemetry: GatewayTelemetry;
  let dropDatabase: () => Promise<void>;
  let identity: IdentityPort;
  let identityHttp: IdentityHttpHandler;
  let closeAccess: () => Promise<void>;
  let closeReports: () => Promise<void>;
  let app: FastifyInstance;
  let baseUrl: string;
  let ana: Identity;
  let finanzas: string;
  let comercial: string;
  let anaRegion: string;
  let secretValues: string[];

  const client = (token?: string) =>
    createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${baseUrl}/api/trpc`,
          methodOverride: 'POST',
          headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
        }),
      ],
    });

  const signIn = (email: string, password = PASSWORD) =>
    fetch(`${baseUrl}/auth/sign-in/email`, {
      method: 'POST',
      headers: { origin: PUBLIC_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  const sessionCookie = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
  const identityToken = async (cookie: string) => {
    const response = await fetch(`${baseUrl}/auth/token`, { headers: { cookie } });
    return { status: response.status, body: (await response.json()) as { token?: string } };
  };
  const signedIn = async (email: string) => {
    const cookie = sessionCookie(await signIn(email));
    const { body } = await identityToken(cookie);
    return { cookie, token: body.token ?? '' };
  };

  beforeAll(async () => {
    if (existsSync(ROOT_ENV_FILE)) {
      process.loadEnvFile(ROOT_ENV_FILE);
    }
    telemetry = startTelemetry({
      otlpEndpoint: 'http://127.0.0.1:0',
      spanProcessors: [new SimpleSpanProcessor(spans)],
    });
    // Only now: instrumentation sees pg and Fastify load (main.ts does the same).
    const config = await import('@atlasbi/config');
    const auth = await import('@atlasbi/auth');
    const { createReportRepository, seedDemoReports } = await import('@atlasbi/reports');
    const { createSemanticRuntime } = await import('@atlasbi/semantic');
    const { migrateToLatest } = await import('@atlasbi/database');
    const { createThrowawayDatabase } = await import('@atlasbi/database/testing');
    const { buildGatewayServer } = await import('../../src/gateway-server.ts');

    const platformConfig = config.loadConfig();
    const secrets = new config.EnvSecretProvider();
    const database = await createThrowawayDatabase(
      await secrets.get(config.SECRET_KEYS.databaseUrl),
    );
    dropDatabase = () => database.drop();
    await migrateToLatest({ connectionString: database.connectionString });
    const secret = `test-secret-${crypto.randomUUID()}`;
    identity = auth.createBetterAuthIdentity({
      connectionString: database.connectionString,
      secret,
    });
    identityHttp = auth.createBetterAuthHttp({
      connectionString: database.connectionString,
      secret,
      publicUrl: PUBLIC_URL,
    });
    const access = auth.createAccessDirectory({ connectionString: database.connectionString });
    closeAccess = () => access.close();
    const reports = createReportRepository({ connectionString: database.connectionString });
    closeReports = () => reports.close();
    const runtime = await createSemanticRuntime({ config: platformConfig, secrets });
    if (runtime === undefined) {
      throw new Error('This test needs the semantic layer: the postgres tier.');
    }
    const semantic: SemanticRuntimePort = runtime;

    // Ana and Bruno, two viewers of Finanzas: Ana sees one region, Bruno all of them.
    const { userId: anaId } = await identity.createUser({
      email: 'ana@example.com',
      name: 'Ana',
      password: PASSWORD,
    });
    const { userId: brunoId } = await identity.createUser({
      email: 'bruno@example.com',
      name: 'Bruno',
      password: PASSWORD,
    });
    const { organizationId } = await identity.createOrganization({
      name: 'Demo',
      slug: 'demo',
      ownerUserId: anaId,
    });
    await identity.addOrganizationMember({ organizationId, userId: brunoId });
    ana = { userId: anaId, organizationId };
    ({ workspaceId: finanzas } = await access.createWorkspace({
      organizationId,
      slug: 'finanzas',
      name: 'Finanzas',
    }));
    ({ workspaceId: comercial } = await access.createWorkspace({
      organizationId,
      slug: 'comercial',
      name: 'Comercial',
    }));
    // Whatever regions the development lakehouse holds: the first one is Ana's.
    const everything = await semantic.query(TOTAL_BY_REGION, {
      ...ana,
      workspaceId: finanzas,
      workspaceRole: 'viewer',
      entitlements: { region: { kind: 'all' } },
    });
    const regions = everything.rows.map((row) => String(row[0]));
    if (regions.length < 2) {
      throw new Error(
        'The development lakehouse needs data in two regions at least: run `pnpm seed`.',
      );
    }
    anaRegion = regions[0] ?? '';
    await access.setMembership({ workspaceId: finanzas, userId: anaId, role: 'viewer' });
    await access.setMembership({ workspaceId: finanzas, userId: brunoId, role: 'viewer' });
    await access.setMembership({ workspaceId: comercial, userId: brunoId, role: 'admin' });
    await access.grantEntitlement({
      workspaceId: finanzas,
      userId: anaId,
      dimension: 'region',
      entitlement: { kind: 'listed', values: [anaRegion] },
    });
    await access.grantEntitlement({
      workspaceId: finanzas,
      userId: brunoId,
      dimension: 'region',
      entitlement: { kind: 'all' },
    });
    await seedDemoReports(reports, [{ workspaceId: finanzas, createdBy: anaId }]);

    app = await buildGatewayServer({
      publicUrl: PUBLIC_URL,
      dependencies: {
        identity,
        identityHttp,
        access,
        semantic,
        reports,
        ready: () => access.ping(),
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    secretValues = [PASSWORD, 'ana@example.com', 'bruno@example.com', secret];
  });

  afterAll(async () => {
    await app?.close();
    await identityHttp?.close();
    await identity?.close();
    await closeAccess?.();
    await closeReports?.();
    await dropDatabase?.();
    await telemetry?.shutdown();
  });

  it('signs in over HTTP and hands out an identity token — nothing else of the provider answers (P5-2)', async () => {
    const signInResponse = await signIn(' ANA@example.com ');
    const cookie = sessionCookie(signInResponse);
    const token = await identityToken(cookie);

    expect(signInResponse.status).toBe(200);
    expect(await signInResponse.json()).toEqual({});
    expect(cookie).toMatch(/^identity\.session_token=/);
    expect(token.status).toBe(200);
    await expect(identity.verifyIdentityToken(token.body.token ?? '')).resolves.toEqual(ana);

    const sessionValue = cookie.split('=')[1] ?? '';
    secretValues.push(sessionValue.split('.')[0] ?? sessionValue, token.body.token ?? '');
    for (const [method, path] of [
      ['GET', '/auth/get-session'],
      ['GET', '/auth/list-sessions'],
      ['POST', '/auth/organization/create'],
      ['POST', '/auth/update-user'],
      ['POST', '/auth/sign-up/email'],
      ['GET', '/auth/jwks'],
    ] as const) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { cookie, origin: PUBLIC_URL, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify({ name: 'Evil', slug: 'evil' }) } : {}),
      });

      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toContain(sessionValue.split('.')[0]);
    }
    expect(await identity.findOrganizationBySlug('evil')).toBeUndefined();
  });

  it('refuses a sign-in without the platform Origin, even with the right password', async () => {
    const response = await fetch(`${baseUrl}/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ana@example.com', password: PASSWORD }),
    });

    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("answers session.me with Ana's workspaces only", async () => {
    const { token } = await signedIn('ana@example.com');

    expect(await client(token).session.me.query()).toEqual({
      ...ana,
      workspaces: [{ workspaceId: finanzas, slug: 'finanzas', name: 'Finanzas', role: 'viewer' }],
    });
  });

  it('shows Ana and Bruno, two viewers of one workspace, different data — the same numbers where they overlap', async () => {
    const asAna = client((await signedIn('ana@example.com')).token);
    const asBruno = client((await signedIn('bruno@example.com')).token);

    const anaRows = (
      await asAna.semantic.query.query({ workspaceId: finanzas, query: TOTAL_BY_REGION })
    ).rows;
    const brunoRows = (
      await asBruno.semantic.query.query({ workspaceId: finanzas, query: TOTAL_BY_REGION })
    ).rows;

    expect(anaRows.map((row) => row[0])).toEqual([anaRegion]);
    expect(brunoRows.length).toBeGreaterThan(1);
    expect(brunoRows.find((row) => row[0] === anaRegion)).toEqual(anaRows[0]);
    expect((await asAna.semantic.meta.query({ workspaceId: finanzas })).measures).toContainEqual(
      expect.objectContaining({ name: 'sales_orders.total_amount' }),
    );
  });

  it('opens the same report for two viewers, and each sees only their data through it (docs/16 §4)', async () => {
    const asAna = client((await signedIn('ana@example.com')).token);
    const asBruno = client((await signedIn('bruno@example.com')).token);

    const [anaReports, brunoReports] = await Promise.all([
      asAna.report.list.query({ workspaceId: finanzas }),
      asBruno.report.list.query({ workspaceId: finanzas }),
    ]);
    expect(anaReports.map((report) => report.name)).toEqual(['Actividad en GitHub', 'Ventas']);
    expect(brunoReports).toEqual(anaReports);
    const reportId = anaReports.find((report) => report.name === 'Ventas')?.id ?? '';
    const report = await asAna.report.get.query({ workspaceId: finanzas, reportId });
    expect(await asBruno.report.get.query({ workspaceId: finanzas, reportId })).toEqual(report);

    // What the bar asks for, as its spec says: the same question, two different answers.
    const bar = report.pages[0]?.visuals.find((visual) => visual.spec.kind === 'bar');
    const query = { measures: bar?.spec.measures ?? [], dimensions: bar?.spec.dimensions ?? [] };
    const anaRows = (await asAna.semantic.query.query({ workspaceId: finanzas, query })).rows;
    const brunoRows = (await asBruno.semantic.query.query({ workspaceId: finanzas, query })).rows;
    expect(anaRows.map((row) => row[0])).toEqual([anaRegion]);
    expect(brunoRows.length).toBeGreaterThan(1);

    // Ana is no member of Comercial: not even the list of its reports.
    await expect(asAna.report.list.query({ workspaceId: comercial })).rejects.toMatchObject({
      data: { code: 'FORBIDDEN' },
    });
  });

  it('refuses what the security context does not allow, with the same answers as without the engine', async () => {
    const asAna = client((await signedIn('ana@example.com')).token);
    const code = (call: Promise<unknown>) =>
      call.then(
        () => 'resolved',
        (error: unknown) =>
          error instanceof TRPCClientError ? (error.data as { code: string }).code : String(error),
      );

    expect(
      await code(asAna.semantic.query.query({ workspaceId: comercial, query: TOTAL_BY_REGION })),
    ).toBe('FORBIDDEN');
    expect(
      await code(
        asAna.semantic.query.query({
          workspaceId: finanzas,
          query: { measures: ['sales_orders.secret_margin'] },
        }),
      ),
    ).toBe('NOT_FOUND');
    expect(
      await code(
        asAna.semantic.query.query({
          workspaceId: finanzas,
          query: { ...TOTAL_BY_REGION, limit: 0 },
        }),
      ),
    ).toBe('BAD_REQUEST');
    expect(await code(client('forged.identity.token').session.me.query())).toBe('UNAUTHORIZED');
  });

  it('signs out: the session hands out no token anymore', async () => {
    const { cookie } = await signedIn('bruno@example.com');

    const signOut = await fetch(`${baseUrl}/auth/sign-out`, {
      method: 'POST',
      headers: { cookie, origin: PUBLIC_URL },
    });

    expect(signOut.status).toBe(200);
    expect((await identityToken(cookie)).status).toBe(401);
  });

  it('is ready while the platform database answers', async () => {
    expect((await fetch(`${baseUrl}/ready`)).status).toBe(200);
  });

  it('traces requests, database queries and Cube calls without a credential, a value or a query string (P5-8)', async () => {
    const clientTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const { cookie } = await signedIn('ana@example.com');
    await fetch(`${baseUrl}/auth/token?probe=query-string-value`, {
      headers: { cookie, traceparent: `00-${clientTraceId}-00f067aa0ba902b7-01` },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const finished = spans.getFinishedSpans();
    const scopes = new Set(finished.map((span) => span.instrumentationScope.name));
    const requestSpans = finished.filter(
      (span) => span.instrumentationScope.name === '@fastify/otel',
    );

    expect([...scopes]).toEqual(
      expect.arrayContaining([
        '@fastify/otel',
        '@opentelemetry/instrumentation-pg',
        '@opentelemetry/instrumentation-undici',
      ]),
    );
    expect(requestSpans.map((span) => span.attributes['url.path'])).toContain('/auth/token');
    // The gateway's own calls to Cube, not only this test's calls to the gateway.
    expect(
      finished.some(
        (span) =>
          span.instrumentationScope.name === '@opentelemetry/instrumentation-undici' &&
          String(span.attributes['url.path']).startsWith('/cubejs-api/v1/'),
      ),
    ).toBe(true);
    // Nobody outside picks the trace a request joins.
    expect(finished.some((span) => span.spanContext().traceId === clientTraceId)).toBe(false);
    const recorded = JSON.stringify(
      finished.map((span) => [span.name, span.attributes, span.events]),
    );
    for (const value of [...secretValues, 'query-string-value', 'Bearer ']) {
      expect(recorded, 'a span recorded a sensitive value').not.toContain(value);
    }
  });
});
