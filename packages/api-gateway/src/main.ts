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
  semantic,
  server,
] = await Promise.all([
  import('@atlasbi/auth'),
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
// Cube runs on the postgres tier only (it reads the lakehouse's S3 data, docs/04 §6.6).
const semanticRuntime =
  config.lakehouse.catalogType === 'postgres'
    ? semantic.createCubeSemanticRuntime({
        url: config.semantic.url,
        apiSecret: await secrets.get(SECRET_KEYS.semanticApiSecret),
      })
    : undefined;

const app = await server.buildGatewayServer({
  publicUrl: config.gateway.publicUrl,
  dependencies: {
    identity,
    identityHttp,
    access,
    semantic: semanticRuntime,
    ready: () => access.ping(),
  },
});

let closing: Promise<void> | undefined;
const close = () => {
  closing ??= (async () => {
    await app.close();
    await Promise.allSettled([identityHttp.close(), identity.close(), access.close()]);
    await telemetry.shutdown();
  })();
  return closing;
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void close());
}

// 127.0.0.1 only (decision G9): the proxy of build step 6 is what faces the network.
await app.listen({ host: '127.0.0.1', port: config.gateway.port });
console.log(`API gateway listening on http://127.0.0.1:${config.gateway.port}`);
