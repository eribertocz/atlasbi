import {
  assertSecretsAvailable,
  createSecretProvider,
  loadConfig,
  requiredSecretKeys,
  SECRET_KEYS,
} from '@atlasbi/config';

import { checkComposeProvider } from '../checks/container-checks.ts';
import { composeUp, ensureEngineRunning } from '../container-runtime/podman.ts';
import { lakehouseReadinessSteps, type LakehouseStartMode } from '../health/lakehouse-probes.ts';
import { localStackReadinessSteps } from '../health/local-stack-probes.ts';
import { runReadinessChain } from '../health/readiness-chain.ts';
import { resolveLakehouseSettings } from '../lakehouse-environment.ts';
import { loadEnvFile, readLocalInfraPorts } from '../local-environment.ts';
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
 * Preflight → configuration (fail fast) → containers → migrations → lakehouse → readiness
 * (docs/19 §3). Only `bootstrap` installs extensions and provisions the lakehouse; `dev` only
 * verifies them. Only reports pieces that exist today; Web/API/Cube join in their build steps.
 */
export async function startLocalStack(mode: LakehouseStartMode = 'dev'): Promise<void> {
  await runPreflight();
  loadEnvFile();

  const config = loadConfig(process.env, { baseDirectory: WORKSPACE_ROOT });
  const secrets = createSecretProvider(config);
  await assertSecretsAvailable(secrets, requiredSecretKeys(config.lakehouse));
  const databaseUrl = await secrets.get(SECRET_KEYS.databaseUrl);
  const lakehouse = await resolveLakehouseSettings(config.lakehouse, secrets);

  await ensureEngineRunning();
  const composeProvider = await checkComposeProvider();
  if (composeProvider.status === 'fail') {
    printChecks('Preflight (engine running)', [composeProvider]);
    throw new PreflightFailedError();
  }

  console.log('\nStarting containers...');
  await composeUp();

  const report = await runReadinessChain([
    ...localStackReadinessSteps(databaseUrl, readLocalInfraPorts()),
    ...lakehouseReadinessSteps(lakehouse, mode),
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
