import { styleText } from 'node:util';

import {
  assertSecretsAvailable,
  createSecretProvider,
  loadConfig,
  loadLakehouseConfig,
  SECRET_KEYS,
  transformSecretKeys,
} from '@atlasbi/config';
import { runSqlMesh, type TransformTarget } from '@atlasbi/transform';
import { describeCatalogType } from '@atlasbi/warehouse';

import { resolveLakehouseSettings } from '../lakehouse-environment.ts';
import { hasEnvFile, loadEnvFile } from '../local-environment.ts';
import { WORKSPACE_ROOT } from '../workspace-paths.ts';

const USAGE =
  'Usage: pnpm transform <SQLMesh command> [options] — e.g. `pnpm transform plan`, `pnpm transform run`, `pnpm transform test`.';
// Commands that only read the project: they run on an in-memory DuckDB, no lakehouse or secrets.
const OFFLINE_COMMANDS = new Set(['test', 'lint', 'format', 'render', 'info']);

export class TransformFailedError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number, failure: string | undefined) {
    super(
      `SQLMesh failed (exit ${exitCode}): ${failure ?? 'no error message'}` +
        '\nSet ATLASBI_TRANSFORM_DEBUG=1 to see the full trace.',
    );
    this.name = 'TransformFailedError';
    this.exitCode = exitCode;
  }
}

/**
 * The only supported way to run SQLMesh (docs/02 §6.1.2): `uv run sqlmesh` directly skips the
 * lakehouse check and the secrets, and is not supported.
 */
export async function runTransform(args: readonly string[]): Promise<void> {
  const [command] = args;
  if (command === undefined || command === '--help') {
    console.log(USAGE);
    return;
  }
  const target = OFFLINE_COMMANDS.has(command) ? offlineTarget() : await lakehouseTarget();
  console.log(
    styleText(
      'gray',
      target.mode === 'lakehouse'
        ? `SQLMesh · lakehouse catalog: ${describeCatalogType(target.lakehouse.catalog.type)}`
        : 'SQLMesh · in-memory DuckDB (no lakehouse needed)',
    ),
  );
  const run = await runSqlMesh(target, args, {
    output: 'terminal',
    debug: process.env.ATLASBI_TRANSFORM_DEBUG === '1',
  });
  if (run.exitCode !== 0) {
    throw new TransformFailedError(run.exitCode, run.failure);
  }
}

function offlineTarget(): TransformTarget {
  if (hasEnvFile()) {
    loadEnvFile();
  }
  const lakehouse = loadLakehouseConfig(process.env, { baseDirectory: WORKSPACE_ROOT });
  return { mode: 'unit-tests', extensionDirectory: lakehouse.extensionDirectory };
}

async function lakehouseTarget(): Promise<TransformTarget> {
  loadEnvFile();
  const config = loadConfig(process.env, { baseDirectory: WORKSPACE_ROOT });
  const secrets = createSecretProvider(config);
  await assertSecretsAvailable(secrets, transformSecretKeys(config.lakehouse));
  return {
    mode: 'lakehouse',
    lakehouse: await resolveLakehouseSettings(config.lakehouse, secrets),
    stateConnectionString: await secrets.get(SECRET_KEYS.transformStateUrl),
  };
}
