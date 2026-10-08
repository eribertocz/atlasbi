import { readLocalInfraPorts } from '../local-environment.ts';
import type { CheckResult } from './check-result.ts';
import { checkContainerRuntime } from './container-checks.ts';
import { checkEnvFile, checkPorts, devPortScope, type PortScope } from './environment-checks.ts';
import { checkLakehouse } from './lakehouse-checks.ts';
import { checkNode, checkPackageManager, checkUv } from './toolchain-checks.ts';
import { checkTransform } from './transform-checks.ts';

/** The machine's checks; ports only for what the command at hand starts (`pnpm dev` by default). */
export async function runPreflightChecks(
  scope: PortScope = devPortScope(),
): Promise<CheckResult[]> {
  return [
    checkNode(),
    checkPackageManager(),
    await checkUv(),
    ...(await checkContainerRuntime()),
    await checkPorts(readLocalInfraPorts(), scope),
    checkEnvFile(),
    ...(await checkLakehouse()),
    await checkTransform(),
  ];
}
