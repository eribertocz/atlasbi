import { mkdir } from 'node:fs/promises';
import path from 'node:path';

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
import {
  devPortScope,
  infrastructurePortScope,
  stackPortScope,
} from '../checks/environment-checks.ts';
import {
  buildImage,
  composeUp,
  ensureEngineRunning,
  execInService,
} from '../container-runtime/podman.ts';
import {
  GATEWAY_CONTAINER_PROBE,
  GATEWAY_SCRIPT,
  GATEWAY_STEP,
  gatewayContainerReadinessStep,
  gatewayReadinessStep,
} from '../health/gateway-probes.ts';
import { identityReadinessStep } from '../health/identity-probes.ts';
import { ingestionBootstrapSteps } from '../health/ingestion-probes.ts';
import { lakehouseReadinessSteps, type LakehouseStartMode } from '../health/lakehouse-probes.ts';
import { localStackReadinessSteps, MIGRATIONS_STEP } from '../health/local-stack-probes.ts';
import {
  objectStorageReadinessSteps,
  type ObjectStorageProvisioning,
} from '../health/object-storage-probes.ts';
import { runReadinessChain } from '../health/readiness-chain.ts';
import { CUBE_STEP, semanticReadinessSteps } from '../health/semantic-probes.ts';
import { transformBootstrapSteps } from '../health/transform-probes.ts';
import { WEB_DEV_SERVER, webReadinessStep } from '../health/web-probes.ts';
import { resolveLakehouseSettings } from '../lakehouse-environment.ts';
import {
  loadEnvFile,
  LOCAL_TIER_SERVICES,
  PLATFORM_IMAGES,
  PLATFORM_SERVICES,
  PORTABLE_TIER_SERVICES,
  readLocalInfraPorts,
  type LocalInfraPorts,
} from '../local-environment.ts';
import { printChecks, printReadiness } from '../output/console-report.ts';
import {
  startDevServer,
  startWatchedProcess,
  type WatchedProcess,
} from '../system/watched-process.ts';
import { WORKSPACE_ROOT } from '../workspace-paths.ts';
import { PreflightFailedError, runPreflight } from './preflight.ts';

export class StackNotReadyError extends Error {
  constructor() {
    super('The local stack is not ready — see the items marked ✗ above.');
    this.name = 'StackNotReadyError';
  }
}

/**
 * Where the platform's own services run (docs/19 §2): not at all (`bootstrap`), as local processes
 * with hot reload (`pnpm dev`), or as containers from their images (`pnpm stack:up`).
 */
export type PlatformServicesMode = 'none' | 'processes' | 'containers';

export interface StartedStack {
  /** The services run as local processes, once ready, each with the label of its output. */
  processes: readonly { label: string; process: WatchedProcess }[];
}

/**
 * Preflight → configuration (fail fast) → containers → migrations → object storage → lakehouse →
 * Cube → API gateway → Web → readiness (docs/19 §3, §9). Only `bootstrap` installs extensions (the
 * host's and Cube's), sets up the object storage's bucket and keys, provisions the lakehouse with
 * its reader role, and prepares the transform and ingestion environments (uv) and SQLMesh's state
 * database; `dev` only verifies. The portable tier (sqlite catalog) starts neither the object
 * storage nor Cube.
 */
export async function startLocalStack(
  mode: LakehouseStartMode = 'dev',
  options: { platform?: PlatformServicesMode } = {},
): Promise<StartedStack> {
  const platform = options.platform ?? 'none';
  await runPreflight(
    platform === 'processes'
      ? devPortScope()
      : platform === 'containers'
        ? stackPortScope()
        : infrastructurePortScope(),
  );
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

  if (platform === 'containers') {
    console.log('\nBuilding the platform images...');
    for (const service of PLATFORM_SERVICES) {
      await buildImage(PLATFORM_IMAGES[service]);
    }
  }

  console.log('\nStarting containers...');
  // A bind mount of a missing folder fails; bootstrap fills this one before Cube reads it.
  await mkdir(config.lakehouse.extensionDirectory, { recursive: true });
  await composeUp([
    ...(postgresTier ? LOCAL_TIER_SERVICES : PORTABLE_TIER_SERVICES),
    ...(platform === 'containers' ? PLATFORM_SERVICES : []),
  ]);

  // docs/19 §9: Postgres → migrations → Cube → API Gateway → Web.
  const gatewayDependsOn = [MIGRATIONS_STEP, ...(postgresTier ? [CUBE_STEP] : [])];
  const gateway =
    platform === 'processes'
      ? gatewayReadinessStep({
          port: config.gateway.port,
          dependsOn: gatewayDependsOn,
          start: () => startWatchedProcess(GATEWAY_SCRIPT, { cwd: WORKSPACE_ROOT }),
        })
      : undefined;
  const web =
    platform === 'none'
      ? undefined
      : webReadinessStep({
          port: config.web.port,
          dependsOn: [GATEWAY_STEP],
          ...(platform === 'processes'
            ? {
                start: () =>
                  startDevServer(WEB_DEV_SERVER.script, ['dev'], {
                    cwd: path.join(WORKSPACE_ROOT, WEB_DEV_SERVER.cwd),
                  }),
              }
            : {}),
        });

  const report = await runReadinessChain([
    ...localStackReadinessSteps(databaseUrl, ports),
    identityReadinessStep({
      connectionString: databaseUrl,
      authSecret: await secrets.get(SECRET_KEYS.authSecret),
    }),
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
    ...(mode === 'bootstrap'
      ? ingestionBootstrapSteps(lakehouse.writer, config.ingestion.dataPath)
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
    ...(platform === 'containers'
      ? [
          gatewayContainerReadinessStep({
            dependsOn: gatewayDependsOn,
            isReady: async () =>
              (await execInService('api-gateway', GATEWAY_CONTAINER_PROBE)).exitCode === 0,
          }),
        ]
      : []),
    ...(web === undefined ? [] : [web.step]),
  ]);
  const processes = [
    { label: 'api-gateway │', process: gateway?.started() },
    { label: 'web │', process: web?.started() },
  ].flatMap(({ label, process: service }) =>
    service === undefined ? [] : [{ label, process: service }],
  );
  printReadiness(report);
  if (!report.ready) {
    await Promise.all(processes.map(({ process: service }) => service.stop()));
    throw new StackNotReadyError();
  }
  return { processes };
}

export class ServiceStoppedError extends Error {
  constructor(label: string) {
    super(`${label.replace(/ │$/, '')} stopped on its own — its output above says why.`);
    this.name = 'ServiceStoppedError';
  }
}

/**
 * The infrastructure, then the API gateway and the web app with hot reload, in the foreground:
 * their output follows the summary until Ctrl+C. The infrastructure keeps running after it.
 */
export async function runDev(): Promise<void> {
  const { processes } = await startLocalStack('dev', { platform: 'processes' });
  console.log(
    '\nThe API gateway and the web app reload on every change. Ctrl+C stops them; the infrastructure keeps running in the background (`pnpm stack:down` stops it).\n',
  );
  for (const { label, process: service } of processes) {
    service.forwardOutput(label);
  }
  const outcome = await Promise.race([
    new Promise<'interrupted'>((resolve) => {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => resolve('interrupted'));
      }
    }),
    ...processes.map(({ label, process: service }) => service.exited.then(() => label)),
  ]);
  await Promise.all(processes.map(({ process: service }) => service.stop()));
  if (outcome !== 'interrupted') {
    throw new ServiceStoppedError(outcome);
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
