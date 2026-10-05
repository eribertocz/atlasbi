import { mkdir } from 'node:fs/promises';

import {
  assertSecretsAvailable,
  authSecretKeys,
  bootstrapSecretKeys,
  createSecretProvider,
  lakehouseReaderSecretKeys,
  loadConfig,
  requiredSecretKeys,
  SECRET_KEYS,
  semanticSecretKeys,
  type LakehouseConfig,
} from '@atlasbi/config';
import type { SecretProvider } from '@atlasbi/contracts';

import { checkComposeProvider } from '../checks/container-checks.ts';
import { composeUp, ensureEngineRunning } from '../container-runtime/podman.ts';
import { GATEWAY_SCRIPT, gatewayReadinessStep } from '../health/gateway-probes.ts';
import { lakehouseReadinessSteps, type LakehouseStartMode } from '../health/lakehouse-probes.ts';
import { localStackReadinessSteps, MIGRATIONS_STEP } from '../health/local-stack-probes.ts';
import {
  objectStorageReadinessSteps,
  type ObjectStorageProvisioning,
} from '../health/object-storage-probes.ts';
import { runReadinessChain } from '../health/readiness-chain.ts';
import { CUBE_STEP, semanticReadinessSteps } from '../health/semantic-probes.ts';
import { transformBootstrapSteps } from '../health/transform-probes.ts';
import { resolveLakehouseSettings } from '../lakehouse-environment.ts';
import {
  loadEnvFile,
  LOCAL_TIER_SERVICES,
  PORTABLE_TIER_SERVICES,
  readLocalInfraPorts,
  type LocalInfraPorts,
} from '../local-environment.ts';
import { printChecks, printReadiness } from '../output/console-report.ts';
import { startWatchedProcess, type WatchedProcess } from '../system/watched-process.ts';
import { WORKSPACE_ROOT } from '../workspace-paths.ts';
import { PreflightFailedError, runPreflight } from './preflight.ts';

export class StackNotReadyError extends Error {
  constructor() {
    super('The local stack is not ready — see the items marked ✗ above.');
    this.name = 'StackNotReadyError';
  }
}

export interface StartedStack {
  /** The API gateway, when it was asked for and became ready. */
  gateway: WatchedProcess | undefined;
}

/**
 * Preflight → configuration (fail fast) → containers → migrations → object storage → lakehouse →
 * Cube → API gateway → readiness (docs/19 §3). Only `bootstrap` installs extensions (the host's
 * and Cube's), sets up the object storage's bucket and keys, provisions the lakehouse with its
 * reader role, and prepares the transform environment (uv) and SQLMesh's state database; `dev`
 * only verifies. The portable tier (sqlite catalog) starts neither the object storage nor Cube.
 * The API gateway runs as a local process (`withGateway`, `pnpm dev` only); Web joins in step 6.
 */
export async function startLocalStack(
  mode: LakehouseStartMode = 'dev',
  options: { withGateway?: boolean } = {},
): Promise<StartedStack> {
  await runPreflight();
  loadEnvFile();

  const config = loadConfig(process.env, { baseDirectory: WORKSPACE_ROOT });
  const secrets = createSecretProvider(config);
  await assertSecretsAvailable(
    secrets,
    mode === 'bootstrap'
      ? bootstrapSecretKeys(config.lakehouse)
      : [
          ...requiredSecretKeys(config.lakehouse),
          ...lakehouseReaderSecretKeys(config.lakehouse),
          ...semanticSecretKeys(config.lakehouse),
          ...authSecretKeys(),
        ],
  );
  const databaseUrl = await secrets.get(SECRET_KEYS.databaseUrl);
  const ports = readLocalInfraPorts();
  const lakehouse = {
    writer: await resolveLakehouseSettings(config.lakehouse, secrets, 'writer'),
    reader: await resolveLakehouseSettings(config.lakehouse, secrets, 'reader'),
  };
  const postgresTier = config.lakehouse.catalogType === 'postgres';

  await ensureEngineRunning();
  const composeProvider = await checkComposeProvider();
  if (composeProvider.status === 'fail') {
    printChecks('Preflight (engine running)', [composeProvider]);
    throw new PreflightFailedError();
  }

  console.log('\nStarting containers...');
  // A bind mount of a missing folder fails; bootstrap fills this one before Cube reads it.
  await mkdir(config.lakehouse.extensionDirectory, { recursive: true });
  await composeUp(postgresTier ? LOCAL_TIER_SERVICES : PORTABLE_TIER_SERVICES);

  const gateway = options.withGateway
    ? gatewayReadinessStep({
        port: config.gateway.port,
        // docs/19 §9: Postgres → migrations → Cube → API Gateway.
        dependsOn: [MIGRATIONS_STEP, ...(postgresTier ? [CUBE_STEP] : [])],
        start: () => startWatchedProcess(GATEWAY_SCRIPT, { cwd: WORKSPACE_ROOT }),
      })
    : undefined;

  const report = await runReadinessChain([
    ...localStackReadinessSteps(databaseUrl, ports),
    ...(postgresTier
      ? objectStorageReadinessSteps(
          adminEndpoint(ports),
          mode === 'bootstrap'
            ? await objectStorageProvisioning(config.lakehouse, secrets, ports)
            : undefined,
        )
      : []),
    ...lakehouseReadinessSteps(
      lakehouse,
      mode,
      mode === 'bootstrap' && postgresTier
        ? {
            adminConnectionString: databaseUrl,
            readerConnectionString: await secrets.get(SECRET_KEYS.lakehouseCatalogReaderUrl),
          }
        : undefined,
    ),
    ...(mode === 'bootstrap'
      ? transformBootstrapSteps(await secrets.get(SECRET_KEYS.transformStateUrl))
      : []),
    ...(postgresTier
      ? semanticReadinessSteps({
          mode,
          extensionDirectory: config.lakehouse.extensionDirectory,
          // The address the gateway uses too (ATLASBI_SEMANTIC_URL, decision G9).
          cubeUrl: config.semantic.url,
          apiSecret: await secrets.get(SECRET_KEYS.semanticApiSecret),
        })
      : []),
    ...(gateway === undefined ? [] : [gateway.step]),
  ]);
  printReadiness(report);
  if (!report.ready) {
    await gateway?.started()?.stop();
    throw new StackNotReadyError();
  }
  return { gateway: gateway?.started() };
}

export class GatewayStoppedError extends Error {
  constructor() {
    super('The API gateway stopped on its own — its output above says why.');
    this.name = 'GatewayStoppedError';
  }
}

/**
 * The infrastructure, then the API gateway with hot reload, in the foreground: its output follows
 * the summary until Ctrl+C. The infrastructure keeps running after it.
 */
export async function runDev(): Promise<void> {
  const { gateway } = await startLocalStack('dev', { withGateway: true });
  if (gateway === undefined) {
    return;
  }
  console.log(
    '\nThe API gateway reloads on every change. Ctrl+C stops it; the infrastructure keeps running in the background (`pnpm stack:down` stops it).\n',
  );
  gateway.forwardOutput('api-gateway │');
  const outcome = await Promise.race([
    new Promise<'interrupted'>((resolve) => {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => resolve('interrupted'));
      }
    }),
    gateway.exited.then(() => 'exited' as const),
  ]);
  await gateway.stop();
  if (outcome === 'exited') {
    throw new GatewayStoppedError();
  }
}

function adminEndpoint(ports: LocalInfraPorts): string {
  return `http://127.0.0.1:${ports.objectStorageAdmin}`;
}

/** The lakehouse bucket (from the S3 URL) and both keys, exactly as .env declares them. */
async function objectStorageProvisioning(
  lakehouse: LakehouseConfig,
  secrets: SecretProvider,
  ports: LocalInfraPorts,
): Promise<ObjectStorageProvisioning> {
  if (lakehouse.storage.kind !== 's3') {
    throw new Error('only the postgres tier keeps its data in the object storage');
  }
  return {
    admin: {
      endpoint: adminEndpoint(ports),
      adminToken: await secrets.get(SECRET_KEYS.objectStorageAdminToken),
    },
    bucket: new URL(lakehouse.storage.url).host,
    writer: {
      name: 'lakehouse-writer',
      accessKeyId: await secrets.get(SECRET_KEYS.lakehouseS3WriterAccessKeyId),
      secretAccessKey: await secrets.get(SECRET_KEYS.lakehouseS3WriterSecretAccessKey),
    },
    reader: {
      name: 'lakehouse-reader',
      accessKeyId: await secrets.get(SECRET_KEYS.lakehouseS3ReaderAccessKeyId),
      secretAccessKey: await secrets.get(SECRET_KEYS.lakehouseS3ReaderSecretAccessKey),
    },
  };
}
