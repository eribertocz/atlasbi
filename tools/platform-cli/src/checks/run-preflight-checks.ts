import { readLocalInfraPorts } from '../local-environment.ts';
import type { CheckResult } from './check-result.ts';
import { checkContainerRuntime } from './container-checks.ts';
import { checkEnvFile, checkPorts } from './environment-checks.ts';
import { checkLakehouse } from './lakehouse-checks.ts';
import { checkNode, checkPackageManager, checkUv } from './toolchain-checks.ts';
import { checkTransform } from './transform-checks.ts';

export async function runPreflightChecks(): Promise<CheckResult[]> {
  return [
    checkNode(),
    checkPackageManager(),
    await checkUv(),
    ...(await checkContainerRuntime()),
    await checkPorts(readLocalInfraPorts()),
    checkEnvFile(),
    ...(await checkLakehouse()),
    await checkTransform(),
  ];
}
