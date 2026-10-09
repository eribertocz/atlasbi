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

import { describeFailure, resolveLakehouseSettings } from '../lakehouse-environment.ts';
import { loadEnvFile, MissingEnvFileError } from '../local-environment.ts';
import { WORKSPACE_ROOT } from '../workspace-paths.ts';

const USAGE = `Usage: pnpm ingest <source> [--json] — sources: ${INGESTION_SOURCES.join(', ')}.`;

class IngestStopped extends Error {
  readonly code: IngestErrorCode;

  constructor(code: IngestErrorCode, message: string) {
    super(message);
    this.name = 'IngestStopped';
    this.code = code;
  }
}

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
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const source = positional[0] ?? '';
  let summary: IngestSummary;
  try {
    if (
      positional.length !== 1 ||
      args.some((arg) => arg.startsWith('--') && arg !== '--json') ||
      !isIngestionSource(source)
    ) {
      throw new IngestStopped('usage_error', USAGE);
    }
    const target = await ingestionTarget(source);
    await assertEnvironmentReady();
    console.error(styleText('gray', `Ingesting ${source} into the landing…`));
    ({ summary } = await runIngestion(source, target, {
      output: 'terminal',
      debug: process.env.ATLASBI_INGEST_DEBUG === '1',
    }));
  } catch (error) {
    summary = ingestionFailure(
      source,
      startedAt,
      error instanceof IngestStopped
        ? { code: error.code, message: error.message }
        : { code: 'internal_error', message: describeFailure(error) },
    );
  }
  if (json) {
    console.log(JSON.stringify(summary));
  }
  console.error(describeOutcome(summary));
  process.exitCode = summary.exitCode;
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
      throw new IngestStopped('configuration_error', error.message);
    }
    throw error;
  }
}

async function assertEnvironmentReady(): Promise<void> {
  const state = await checkIngestionEnvironment();
  if (state === 'missing-uv') {
    throw new IngestStopped(
      'configuration_error',
      '`uv` was not found on PATH — see `pnpm preflight`.',
    );
  }
  if (state === 'out-of-sync') {
    throw new IngestStopped(
      'configuration_error',
      'The ingestion environment is not prepared or out of date — run `pnpm bootstrap`.',
    );
  }
}

function describeOutcome(summary: IngestSummary): string {
  if (summary.error === undefined) {
    return styleText('green', `Ingestion of ${summary.source} succeeded.`);
  }
  const retry = summary.retryable ? ' It can be run again as it is.' : '';
  return styleText(
    'red',
    `Ingestion failed (${summary.error.code}, exit ${summary.exitCode}): ${summary.error.message}${retry}`,
  );
}
