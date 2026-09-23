import {
  assertSecretsAvailable,
  createSecretProvider,
  loadConfig,
  SECRET_KEYS,
} from '@atlasbi/config';

import { checkComposeProvider } from '../checks/container-checks.ts';
import { composeUp, ensureEngineRunning } from '../container-runtime/podman.ts';
import { localStackReadinessSteps } from '../health/local-stack-probes.ts';
import { runReadinessChain } from '../health/readiness-chain.ts';
import { loadEnvFile, readLocalInfraPorts } from '../local-environment.ts';
import { printChecks, printReadiness } from '../output/console-report.ts';
import { PreflightFailedError, runPreflight } from './preflight.ts';

export class StackNotReadyError extends Error {
  constructor() {
    super('The local stack is not ready — see the items marked ✗ above.');
    this.name = 'StackNotReadyError';
  }
}

/**
 * Preflight → configuration (fail fast) → containers → migrations → readiness (docs/19 §3).
 * Only reports pieces that exist today; Web/API/Cube join the chain in their build steps.
 */
export async function startLocalStack(): Promise<void> {
  await runPreflight();
  loadEnvFile();

  const config = loadConfig();
  const secrets = createSecretProvider(config);
  await assertSecretsAvailable(secrets, [SECRET_KEYS.databaseUrl]);
  const databaseUrl = await secrets.get(SECRET_KEYS.databaseUrl);

  await ensureEngineRunning();
  const composeProvider = await checkComposeProvider();
  if (composeProvider.status === 'fail') {
    printChecks('Preflight (engine running)', [composeProvider]);
    throw new PreflightFailedError();
  }

  console.log('\nStarting containers...');
  await composeUp();

  const report = await runReadinessChain(
    localStackReadinessSteps(databaseUrl, readLocalInfraPorts()),
  );
  printReadiness(report);
  if (!report.ready) {
    throw new StackNotReadyError();
  }
}

export async function runDev(): Promise<void> {
  await startLocalStack();
  // Until the API Gateway and Web exist (build steps 5–6) there is nothing to hot-reload.
  console.log('\nInfrastructure keeps running in the background. Stop it with `pnpm stack:down`.');
}
