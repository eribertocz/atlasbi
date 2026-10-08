import type { PortScope } from '../checks/environment-checks.ts';
import { runPreflightChecks } from '../checks/run-preflight-checks.ts';
import { hasEnvFile, loadEnvFile } from '../local-environment.ts';
import { printChecks } from '../output/console-report.ts';

export class PreflightFailedError extends Error {
  constructor() {
    super('Preflight failed: fix the items marked ✗ above and run the command again.');
    this.name = 'PreflightFailedError';
  }
}

/** Verifies the machine only — never starts, installs or changes anything. */
export async function runPreflight(scope?: PortScope): Promise<void> {
  if (hasEnvFile()) {
    loadEnvFile();
  }
  const results = await runPreflightChecks(scope);
  printChecks('Preflight', results);
  if (results.some((result) => result.status === 'fail')) {
    throw new PreflightFailedError();
  }
}
