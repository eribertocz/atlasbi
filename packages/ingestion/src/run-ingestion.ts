import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  exitCodeFor,
  INGEST_JOB_VERSION,
  type IngestErrorCode,
  type IngestSummary,
  LakehouseError,
  parseIngestSummary,
} from '@atlasbi/contracts';
import {
  createLakehouseAdmin,
  resolveLakehouseLocation,
  type LakehouseSettings,
} from '@atlasbi/warehouse';

/** Folder of the uv project (pyproject.toml, uv.lock, .venv) and of the runner. */
export const INGESTION_PACKAGE_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

/** The sources the platform ingests (docs/03); a source that reads directly never appears here. */
export const INGESTION_SOURCES = ['github'] as const;

export type IngestionSource = (typeof INGESTION_SOURCES)[number];

export interface GitHubSourceSettings {
  /** `owner/name`. */
  repositories: readonly string[];
  apiUrl: string;
  token: string;
}

export interface IngestionTarget {
  /** The lakehouse as its writer (decision K3): the landing is written by the ingestion. */
  lakehouse: LakehouseSettings;
  /** Absolute: the tool's working directories and the home the runner gives it. */
  dataDirectory: string;
  /** Not needed to publish the landing only: that never asks the source. */
  github?: GitHubSourceSettings;
}

export interface RunIngestionOptions {
  /** `terminal` streams the runner's progress (stderr) as it comes; `capture` collects it. */
  output?: 'terminal' | 'capture';
  /** The runner prints the full trace of a failure on stderr. */
  debug?: boolean;
  /** HTTP attempts per request to the source; tests use 1, so a failure answers at once. */
  requestAttempts?: number;
  /**
   * Load nothing: publish the landing from what is already loaded — typed and empty before the
   * first load — so transformation can be planned before anything is ingested (`pnpm bootstrap`).
   */
  landingOnly?: boolean;
}

export interface IngestionRun {
  summary: IngestSummary;
  /** The runner's own output; never parsed, never carries a secret. */
  stderr: string;
}

export function isIngestionSource(value: string): value is IngestionSource {
  return (INGESTION_SOURCES as readonly string[]).includes(value);
}

/**
 * The only supported way to run the ingestion (docs/03): the lakehouse is opened first the
 * platform's way — never created, since dlt attaches with IF NOT EXISTS and would silently start an
 * empty lakehouse on a wrong catalog (the same trap as SQLMesh, build step 2) — then the runner
 * gets exactly what it needs through its environment, secrets included, and nothing else.
 */
export async function runIngestion(
  source: IngestionSource,
  target: IngestionTarget,
  options: RunIngestionOptions = {},
): Promise<IngestionRun> {
  const startedAt = new Date().toISOString();
  try {
    await assertProvisioned(target.lakehouse);
  } catch (error) {
    if (error instanceof LakehouseError) {
      return { summary: ingestionFailure(source, startedAt, lakehouseFailure(error)), stderr: '' };
    }
    throw error;
  }
  return spawnRunner(source, target, options);
}

async function assertProvisioned(settings: LakehouseSettings): Promise<void> {
  const admin = await createLakehouseAdmin(settings);
  try {
    await admin.checkHealth();
  } finally {
    await admin.close();
  }
}

function spawnRunner(
  source: IngestionSource,
  target: IngestionTarget,
  options: RunIngestionOptions,
): Promise<IngestionRun> {
  const terminal = options.output === 'terminal';
  return new Promise((resolve, reject) => {
    const child = spawn(
      'uv',
      [
        'run',
        '--frozen',
        '--offline',
        'python',
        '-m',
        'runner',
        source,
        '--json',
        ...(options.landingOnly === true ? ['--landing-only'] : []),
      ],
      {
        cwd: INGESTION_PACKAGE_DIRECTORY,
        env: childEnvironment(target, options),
        stdio: ['ignore', 'pipe', terminal ? 'inherit' : 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.once('error', (error: NodeJS.ErrnoException) =>
      reject(
        error.code === 'ENOENT'
          ? new Error('`uv` was not found on PATH — install it (see `pnpm preflight`).')
          : error,
      ),
    );
    child.once('close', (code) => {
      const line = stdout.trim().split(/\r?\n/).at(-1) ?? '';
      try {
        const summary = parseIngestSummary(JSON.parse(line) as unknown);
        if (summary.exitCode !== (code ?? 1)) {
          throw new Error(`exit code ${code ?? 'none'} differs from the summary's`);
        }
        resolve({ summary, stderr });
      } catch (error) {
        // A runner that crashed before its summary is an internal error, not a parse failure.
        resolve({
          summary: ingestionFailure(source, new Date().toISOString(), {
            code: 'internal_error',
            message: `The ingestion runner stopped without a valid summary (exit ${code ?? 'none'}): ${
              error instanceof Error ? error.message : String(error)
            }. Run it again with ATLASBI_INGEST_DEBUG=1 to see the trace.`,
          }),
          stderr,
        });
      }
    });
  });
}

/**
 * Only what the runner needs: no other ATLASBI_* variable, no PG* variable of the caller's. The
 * catalog password travels in PGPASSWORD, never in the URL (Phase 0: DuckDB repeats the URL in its
 * errors, and dlt keeps those in its trace).
 */
export function childEnvironment(
  target: IngestionTarget,
  options: Pick<RunIngestionOptions, 'debug' | 'requestAttempts'> = {},
): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !/^(ATLASBI_|PG|DESTINATION__|SOURCES__|RUNTIME__|LOAD__|NORMALIZE__)/i.test(name),
    ),
  );
  const location = resolveLakehouseLocation(target.lakehouse);
  const { catalog, storage } = target.lakehouse;
  const catalogVariables: NodeJS.ProcessEnv = {};
  if (catalog.type === 'postgres') {
    const url = new URL(catalog.connectionString);
    catalogVariables.PGPASSWORD = decodeURIComponent(url.password);
    url.password = '';
    catalogVariables.ATLASBI_LAKEHOUSE_CATALOG_URL = url.toString();
  } else {
    catalogVariables.ATLASBI_LAKEHOUSE_SQLITE_PATH = location.sqliteCatalogPath ?? '';
  }
  return {
    ...inherited,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    ATLASBI_INGESTION_MODE: 'platform',
    ATLASBI_INGESTION_DATA_PATH: target.dataDirectory,
    ATLASBI_DUCKDB_EXTENSION_DIRECTORY: location.extensionDirectory,
    ATLASBI_LAKEHOUSE_CATALOG_TYPE: catalog.type,
    // The exact spelling the catalog recorded; anything else is a data path mismatch.
    ATLASBI_LAKEHOUSE_DATA_PATH: location.dataPath,
    ...catalogVariables,
    ...(storage.kind === 's3'
      ? {
          ATLASBI_LAKEHOUSE_S3_ENDPOINT: storage.endpoint,
          ATLASBI_LAKEHOUSE_S3_REGION: storage.region,
          ATLASBI_LAKEHOUSE_S3_USE_SSL: String(storage.useSsl),
          ATLASBI_LAKEHOUSE_S3_ACCESS_KEY_ID: storage.accessKeyId,
          ATLASBI_LAKEHOUSE_S3_SECRET_ACCESS_KEY: storage.secretAccessKey,
        }
      : {}),
    ...(target.github === undefined
      ? {}
      : {
          ATLASBI_GITHUB_REPOSITORIES: target.github.repositories.join(','),
          ATLASBI_GITHUB_API_URL: target.github.apiUrl,
          ATLASBI_GITHUB_TOKEN: target.github.token,
        }),
    /* eslint-disable @typescript-eslint/naming-convention -- dlt's variables, SECTION__KEY. */
    // dlt: no telemetry, no config file read from the working directory, no local copy of the
    // data once it is loaded (Phase 0).
    RUNTIME__DLTHUB_TELEMETRY: 'false',
    // Its warnings name every column a load left empty — noise for a person, since the landing
    // reads a handful of them (Phase C). They come back with the trace, when asked.
    RUNTIME__LOG_LEVEL: options.debug === true ? 'WARNING' : 'ERROR',
    DLT_PROJECT_DIR: target.dataDirectory,
    LOAD__DELETE_COMPLETED_JOBS: 'true',
    ...(options.requestAttempts === undefined
      ? {}
      : { RUNTIME__REQUEST_MAX_ATTEMPTS: String(options.requestAttempts) }),
    /* eslint-enable @typescript-eslint/naming-convention */
    ...(options.debug === true ? { ATLASBI_INGEST_DEBUG: '1' } : {}),
  };
}

/** What a failure of the lakehouse means for the job, in its own terms (it never creates one). */
function lakehouseFailure(error: LakehouseError): { code: IngestErrorCode; message: string } {
  const message = error.remedy === undefined ? error.message : `${error.message} ${error.remedy}`;
  // The warehouse gives a refused password and a missing database the same code; its own message
  // (never the engine's) tells them apart, and the integration tests pin both.
  switch (error.code) {
    case 'catalog_unreachable':
      return {
        code: error.retryable
          ? 'catalog_unavailable'
          : /authentication failed/i.test(error.message)
            ? 'credentials_refused'
            : 'configuration_error',
        message,
      };
    case 'storage_unreachable':
      return {
        code: error.retryable
          ? 'storage_unavailable'
          : /refused the request/i.test(error.message)
            ? 'credentials_refused'
            : 'configuration_error',
        message,
      };
    case 'catalog_busy':
    case 'write_conflict':
      return { code: 'catalog_unavailable', message };
    case 'extension_missing':
    case 'catalog_format_mismatch':
    case 'data_path_mismatch':
      return { code: 'configuration_error', message };
    default:
      return { code: 'internal_error', message };
  }
}

/**
 * The summary of a run that failed before the runner could answer — a usage or configuration error
 * of its caller, a lakehouse that does not open — so every outcome has one, whoever stopped it.
 */
export function ingestionFailure(
  source: string,
  startedAt: string,
  error: { code: IngestErrorCode; message: string },
): IngestSummary {
  const exitCode = exitCodeFor(error.code);
  return {
    jobVersion: INGEST_JOB_VERSION,
    source,
    status: 'failed',
    exitCode,
    retryable: exitCode === 75,
    startedAt,
    finishedAt: new Date().toISOString(),
    loads: [],
    landing: [],
    error,
  };
}
