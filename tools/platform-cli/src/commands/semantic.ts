import { styleText } from 'node:util';

import {
  assertSecretsAvailable,
  ConfigurationError,
  createSecretProvider,
  loadConfig,
  SECRET_KEYS,
  semanticSecretKeys,
} from '@atlasbi/config';
import type { SemanticRefreshErrorCode, SemanticRefreshSummary } from '@atlasbi/contracts';
import {
  refreshSemanticLayer,
  semanticRefreshFailure,
  type SemanticRefreshTarget,
} from '@atlasbi/semantic';

import { JobStopped, parseJobArguments, reportJob } from '../jobs/run-job.ts';
import { describeFailure } from '../lakehouse-environment.ts';
import { loadEnvFile, MissingEnvFileError } from '../local-environment.ts';
import { WORKSPACE_ROOT } from '../workspace-paths.ts';

const USAGE =
  'Usage: pnpm semantic refresh [--json] — rebuilds what the semantic layer keeps precomputed, ' +
  'after transformation published new data.';

/**
 * The semantic refresh job (Plan C, docs/07 §7.1): every outcome ends in a summary and its exit
 * code — `--json` prints the summary alone on stdout.
 */
export async function runSemantic(args: readonly string[]): Promise<void> {
  if (args[0] === undefined || args[0] === '--help') {
    console.log(USAGE);
    return;
  }
  const startedAt = new Date().toISOString();
  const json = args.includes('--json');
  let summary: SemanticRefreshSummary;
  try {
    const { positional } = parseJobArguments(args, USAGE);
    if (positional.length !== 1 || positional[0] !== 'refresh') {
      throw new JobStopped('usage_error', USAGE);
    }
    const target = await semanticTarget();
    console.error(styleText('gray', 'Refreshing the semantic layer…'));
    summary = await refreshSemanticLayer(target);
  } catch (error) {
    summary = semanticRefreshFailure(
      startedAt,
      error instanceof JobStopped
        ? { code: error.code as SemanticRefreshErrorCode, message: error.message }
        : { code: 'internal_error', message: describeFailure(error) },
    );
  }
  reportJob('Semantic refresh', summary, json);
}

async function semanticTarget(): Promise<SemanticRefreshTarget> {
  try {
    loadEnvFile();
    const config = loadConfig(process.env, { baseDirectory: WORKSPACE_ROOT });
    if (!config.semantic.enabled) {
      throw new JobStopped(
        'configuration_error',
        'This tier runs no semantic layer (a SQLite catalog): there is nothing to refresh.',
      );
    }
    const secrets = createSecretProvider(config);
    await assertSecretsAvailable(secrets, semanticSecretKeys(config.lakehouse));
    return {
      url: config.semantic.url,
      apiSecret: await secrets.get(SECRET_KEYS.semanticApiSecret),
    };
  } catch (error) {
    if (error instanceof ConfigurationError || error instanceof MissingEnvFileError) {
      throw new JobStopped('configuration_error', error.message);
    }
    throw error;
  }
}
