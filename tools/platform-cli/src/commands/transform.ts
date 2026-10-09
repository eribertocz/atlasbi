import { styleText } from 'node:util';

import {
  assertSecretsAvailable,
  ConfigurationError,
  createSecretProvider,
  loadConfig,
  loadLakehouseConfig,
  SECRET_KEYS,
  transformSecretKeys,
} from '@atlasbi/config';
import type { TransformErrorCode, TransformJobSummary } from '@atlasbi/contracts';
import {
  checkTransformEnvironment,
  isTransformVerb,
  runTransformJob,
  runTransformTool,
  TRANSFORM_JOBS,
  transformFailure,
  transformJobNeedsLakehouse,
  type TransformTarget,
} from '@atlasbi/transform';
import { describeCatalogType } from '@atlasbi/warehouse';

import {
  assertEnvironmentReady,
  JobStopped,
  parseJobArguments,
  reportJob,
} from '../jobs/run-job.ts';
import { describeFailure, resolveLakehouseSettings } from '../lakehouse-environment.ts';
import { hasEnvFile, loadEnvFile, MissingEnvFileError } from '../local-environment.ts';
import { WORKSPACE_ROOT } from '../workspace-paths.ts';

const USAGE =
  `Usage: pnpm transform <${TRANSFORM_JOBS.join(' | ')}> [--json]\n` +
  '  run     the pending intervals of the deployed models (daily)\n' +
  '  deploy  the models as the repository has them become the ones that run (CI/CD)\n' +
  "  test    the models' unit tests, without a lakehouse\n" +
  "  check   the project's rules and the audits of the published data\n" +
  'Development only: `pnpm transform tool <arguments>` — outside the job contract.';

const TOOL_WARNING =
  '`pnpm transform tool` hands its arguments to the transformation tool itself: OUTSIDE the job ' +
  'contract, for development only — never in the orchestrator nor in CI, which use the verbs ' +
  `(${TRANSFORM_JOBS.join(', ')}).`;

// The tool's commands that only read the project: an in-memory engine, no lakehouse, no secrets.
const OFFLINE_TOOL_COMMANDS = new Set(['test', 'lint', 'format', 'render', 'info']);

export class TransformToolFailedError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number, failure: string | undefined) {
    super(
      `The transformation tool failed (exit ${exitCode}): ${failure ?? 'no error message'}` +
        '\nSet ATLASBI_TRANSFORM_DEBUG=1 to see the full trace.',
    );
    this.name = 'TransformToolFailedError';
    this.exitCode = exitCode;
  }
}

/**
 * The transformation job (Plan C, docs/02 §6.5, docs/07 §7.1): one verb per run, and every outcome
 * ends in a summary and its exit code — `--json` prints the summary alone on stdout; the tool's
 * own output always goes to stderr. `pnpm transform tool` is the only way past the verbs.
 */
export async function runTransform(args: readonly string[]): Promise<void> {
  const [first, ...rest] = args;
  if (first === undefined || first === '--help') {
    console.log(USAGE);
    return;
  }
  if (first === 'tool') {
    await runTool(rest);
    return;
  }
  const startedAt = new Date().toISOString();
  const json = args.includes('--json');
  let verb = '';
  let summary: TransformJobSummary;
  try {
    const { positional } = parseJobArguments(args, USAGE);
    verb = positional[0] ?? '';
    if (positional.length !== 1 || !isTransformVerb(verb)) {
      throw new JobStopped('usage_error', USAGE);
    }
    const target = await transformTarget(transformJobNeedsLakehouse(verb));
    assertEnvironmentReady(await checkTransformEnvironment(), 'transformation');
    console.error(styleText('gray', describeTarget(target)));
    ({ summary } = await runTransformJob(verb, target, {
      output: 'terminal',
      debug: process.env.ATLASBI_TRANSFORM_DEBUG === '1',
    }));
  } catch (error) {
    summary = transformFailure(
      verb,
      startedAt,
      error instanceof JobStopped
        ? { code: error.code as TransformErrorCode, message: error.message }
        : { code: 'internal_error', message: describeFailure(error) },
    );
  }
  reportJob(`Transformation (${summary.verb || 'no verb'})`, summary, json);
}

async function runTool(args: readonly string[]): Promise<void> {
  console.error(styleText('yellow', TOOL_WARNING));
  const [command] = args;
  if (command === undefined) {
    console.error('Usage: pnpm transform tool <arguments of the transformation tool>');
    process.exitCode = 64;
    return;
  }
  const target = await transformTarget(!OFFLINE_TOOL_COMMANDS.has(command)).catch(
    (error: unknown) => {
      throw error instanceof JobStopped ? new Error(error.message) : error;
    },
  );
  console.error(styleText('gray', describeTarget(target)));
  const run = await runTransformTool(target, args, {
    output: 'terminal',
    debug: process.env.ATLASBI_TRANSFORM_DEBUG === '1',
  });
  if (run.exitCode !== 0) {
    throw new TransformToolFailedError(run.exitCode, run.failure);
  }
}

async function transformTarget(lakehouse: boolean): Promise<TransformTarget> {
  try {
    if (!lakehouse) {
      if (hasEnvFile()) {
        loadEnvFile();
      }
      const config = loadLakehouseConfig(process.env, { baseDirectory: WORKSPACE_ROOT });
      return { mode: 'unit-tests', extensionDirectory: config.extensionDirectory };
    }
    loadEnvFile();
    const config = loadConfig(process.env, { baseDirectory: WORKSPACE_ROOT });
    const secrets = createSecretProvider(config);
    await assertSecretsAvailable(secrets, transformSecretKeys(config.lakehouse));
    return {
      mode: 'lakehouse',
      lakehouse: await resolveLakehouseSettings(config.lakehouse, secrets),
      stateConnectionString: await secrets.get(SECRET_KEYS.transformStateUrl),
    };
  } catch (error) {
    if (error instanceof ConfigurationError || error instanceof MissingEnvFileError) {
      throw new JobStopped('configuration_error', error.message);
    }
    throw error;
  }
}

function describeTarget(target: TransformTarget): string {
  return target.mode === 'lakehouse'
    ? `Transformation · lakehouse catalog: ${describeCatalogType(target.lakehouse.catalog.type)}`
    : 'Transformation · in-memory engine (no lakehouse needed)';
}
