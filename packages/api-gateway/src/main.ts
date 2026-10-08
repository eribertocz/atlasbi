import {
  assertSecretsAvailable,
  createSecretProvider,
  gatewaySecretKeys,
  loadConfig,
  SECRET_KEYS,
} from '@atlasbi/config';

import { startTelemetry } from './telemetry.ts';

/**
 * The API gateway process (`pnpm dev` runs it with `node --watch`, decision G7). Configuration and
 * secrets first, failing fast; telemetry next, before Fastify and pg are loaded — the server
 * module is imported only then, so its instrumentation sees them.
 */
const config = loadConfig();
const secrets = createSecretProvider(config);
await assertSecretsAvailable(secrets, gatewaySecretKeys(config.lakehouse));
const telemetry = startTelemetry({ otlpEndpoint: config.telemetry.otlpEndpoint });

const [
  { createAccessDirectory, createBetterAuthHttp, createBetterAuthIdentity },
  { createReportRepository },
  semantic,
  server,
] = await Promise.all([
  import('@atlasbi/auth'),
  import('@atlasbi/reports'),
  import('@atlasbi/semantic'),
  import('./gateway-server.ts'),
]);

const connectionString = await secrets.get(SECRET_KEYS.databaseUrl);
const authSecret = await secrets.get(SECRET_KEYS.authSecret);
const identity = createBetterAuthIdentity({ connectionString, secret: authSecret });
const identityHttp = createBetterAuthHttp({
  connectionString,
  secret: authSecret,
  publicUrl: config.gateway.publicUrl,
});
const access = createAccessDirectory({ connectionString });
const reports = createReportRepository({ connectionString });
// Which engine, and whether there is one in this deployment, is the semantic package's business.
const semanticRuntime = await semantic.createSemanticRuntime({ config, secrets });

const app = await server.buildGatewayServer({
  publicUrl: config.gateway.publicUrl,
  trustedProxies: config.gateway.trustedProxies,
  dependencies: {
    identity,
    identityHttp,
    access,
    semantic: semanticRuntime,
    reports,
    ready: async () => {
      await Promise.all([access.ping(), reports.ping()]);
    },
  },
});

let closing: Promise<void> | undefined;
const close = () => {
  closing ??= (async () => {
    await app.close();
    await Promise.allSettled([
      identityHttp.close(),
      identity.close(),
      access.close(),
      reports.close(),
    ]);
    await telemetry.shutdown();
  })();
  return closing;
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void close());
}

// 127.0.0.1 under `pnpm dev` (decision G9); in its container, its internal network only: the proxy
// is what faces the network (build step 6).
await app.listen({ host: config.gateway.host, port: config.gateway.port });
console.log(`API gateway listening on http://${config.gateway.host}:${config.gateway.port}`);
