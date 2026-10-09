import { styleText } from 'node:util';

import {
  assertSecretsAvailable,
  ConfigurationError,
  createSecretProvider,
  ingestionSecretKeys,
  loadConfig,
  SECRET_KEYS,
} from '@atlasbi/config';
import type { IngestErrorCode, IngestSummary } from '@atlasbi/contracts';
import {
  checkIngestionEnvironment,
  INGESTION_SOURCES,
  ingestionFailure,
  isIngestionSource,
  runIngestion,
  type IngestionSource,
  type IngestionTarget,
} from '@atlasbi/ingestion';

import {
  assertEnvironmentReady,
  JobStopped,
  parseJobArguments,
  reportJob,
} from '../jobs/run-job.ts';
import { describeFailure, resolveLakehouseSettings } from '../lakehouse-environment.ts';
import { loadEnvFile, MissingEnvFileError } from '../local-environment.ts';
import { WORKSPACE_ROOT } from '../workspace-paths.ts';

const USAGE = `Usage: pnpm ingest <source> [--json] — sources: ${INGESTION_SOURCES.join(', ')}.`;

/**
 * The ingestion job (docs/03, build step 7): every outcome ends in a summary and its exit code, the
 * contract the orchestrator of build step 8 reads — `--json` prints the summary on stdout and
 * nothing else there; the progress always goes to stderr.
 */
export async function runIngest(args: readonly string[]): Promise<void> {
  if (args.includes('--help')) {
    console.log(USAGE);
    return;
  }
  const startedAt = new Date().toISOString();
  const json = args.includes('--json');
  let source = '';
  let summary: IngestSummary;
  try {
    const { positional } = parseJobArguments(args, USAGE);
    source = positional[0] ?? '';
    if (positional.length !== 1 || !isIngestionSource(source)) {
      throw new JobStopped('usage_error', USAGE);
    }
    const target = await ingestionTarget(source);
    assertEnvironmentReady(await checkIngestionEnvironment(), 'ingestion');
    console.error(styleText('gray', `Ingesting ${source} into the landing…`));
    ({ summary } = await runIngestion(source, target, {
      output: 'terminal',
      debug: process.env.ATLASBI_INGEST_DEBUG === '1',
    }));
  } catch (error) {
    summary = ingestionFailure(
      source,
      startedAt,
      error instanceof JobStopped
        ? { code: error.code as IngestErrorCode, message: error.message }
        : { code: 'internal_error', message: describeFailure(error) },
    );
  }
  reportJob(`Ingestion of ${summary.source || 'a source'}`, summary, json);
}

async function ingestionTarget(source: IngestionSource): Promise<IngestionTarget> {
  try {
    loadEnvFile();
    const config = loadConfig(process.env, { baseDirectory: WORKSPACE_ROOT });
    const secrets = createSecretProvider(config);
    await assertSecretsAvailable(secrets, ingestionSecretKeys(config.lakehouse, source));
    return {
      lakehouse: await resolveLakehouseSettings(config.lakehouse, secrets),
      dataDirectory: config.ingestion.dataPath,
      github: {
        repositories: config.ingestion.github.repositories,
        apiUrl: config.ingestion.github.apiUrl,
        token: await secrets.get(SECRET_KEYS.githubToken),
      },
    };
  } catch (error) {
    if (error instanceof ConfigurationError || error instanceof MissingEnvFileError) {
      throw new JobStopped('configuration_error', error.message);
    }
    throw error;
  }
}
