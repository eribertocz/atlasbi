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
import { lakehouseReadinessSteps, type LakehouseStartMode } from '../health/lakehouse-probes.ts';
import { localStackReadinessSteps } from '../health/local-stack-probes.ts';
import {
  objectStorageReadinessSteps,
  type ObjectStorageProvisioning,
} from '../health/object-storage-probes.ts';
import { runReadinessChain } from '../health/readiness-chain.ts';
import { semanticReadinessSteps } from '../health/semantic-probes.ts';
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
import { WORKSPACE_ROOT } from '../workspace-paths.ts';
import { PreflightFailedError, runPreflight } from './preflight.ts';

export class StackNotReadyError extends Error {
  constructor() {
    super('The local stack is not ready — see the items marked ✗ above.');
    this.name = 'StackNotReadyError';
  }
}

/**
 * Preflight → configuration (fail fast) → containers → migrations → object storage → lakehouse →
 * Cube → readiness (docs/19 §3). Only `bootstrap` installs extensions (the host's and Cube's), sets
 * up the object storage's bucket and keys, provisions the lakehouse with its reader role, and
 * prepares the transform environment (uv) and SQLMesh's state database; `dev` only verifies. The
 * portable tier (sqlite catalog) starts neither the object storage nor Cube. Only reports pieces
 * that exist today; Web/API join in their build steps.
 */
export async function startLocalStack(mode: LakehouseStartMode = 'dev'): Promise<void> {
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
          cubeUrl: `http://127.0.0.1:${ports.cube}`,
          apiSecret: await secrets.get(SECRET_KEYS.semanticApiSecret),
        })
      : []),
  ]);
  printReadiness(report);
  if (!report.ready) {
    throw new StackNotReadyError();
  }
}

export async function runDev(): Promise<void> {
  await startLocalStack('dev');
  // Until the API Gateway and Web exist (build steps 5–6) there is nothing to hot-reload.
  console.log('\nInfrastructure keeps running in the background. Stop it with `pnpm stack:down`.');
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
