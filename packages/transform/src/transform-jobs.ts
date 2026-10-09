import { spawn } from 'node:child_process';

import {
  jobErrorForLakehouseFailure,
  LakehouseError,
  parseTransformSummary,
  TRANSFORM_JOB_VERSION,
  TRANSFORM_VERBS,
  type TransformErrorCode,
  type TransformJobSummary,
  type TransformVerb,
  transformExitCodeFor,
} from '@atlasbi/contracts';

import {
  childEnvironment,
  provisionedLakehouseId,
  SQLMESH_PROJECT_DIRECTORY,
  stateSchemaFor,
  TRANSFORM_PACKAGE_DIRECTORY,
  type TransformTarget,
} from './run-sqlmesh.ts';

/** The verbs of the transformation job (Plan C, docs/07 §7.1) — the only supported way in. */
export const TRANSFORM_JOBS = TRANSFORM_VERBS;

/** `test` reads only the project: it runs on an in-memory engine, no lakehouse, no secrets. */
export function transformJobNeedsLakehouse(verb: TransformVerb): boolean {
  return verb !== 'test';
}

export function isTransformVerb(value: string): value is TransformVerb {
  return (TRANSFORM_VERBS as readonly string[]).includes(value);
}

export interface TransformJobOptions {
  /** `terminal` streams the tool's own output (stderr) as it comes; `capture` collects it. */
  output?: 'terminal' | 'capture';
  /** The runner prints the full trace of a failure on stderr. */
  debug?: boolean;
  /** A copy of the project (tests); defaults to the package's own. */
  projectDirectory?: string;
}

export interface TransformJobRun {
  summary: TransformJobSummary;
  /** The runner's human output; never parsed, never carries a secret. */
  stderr: string;
}

/**
 * Runs one verb of the transformation job and returns its summary, whatever happened. Before the
 * tool attaches the lakehouse, the platform opens it the platform's way, never creating it (build
 * step 2): a lakehouse that does not open is answered here, with the job's own codes.
 */
export async function runTransformJob(
  verb: TransformVerb,
  target: TransformTarget,
  options: TransformJobOptions = {},
): Promise<TransformJobRun> {
  const startedAt = new Date().toISOString();
  let stateSchema: string | undefined;
  if (target.mode === 'lakehouse') {
    try {
      stateSchema = stateSchemaFor(await provisionedLakehouseId(target.lakehouse));
    } catch (error) {
      if (error instanceof LakehouseError) {
        return {
          summary: transformFailure(verb, startedAt, jobErrorForLakehouseFailure(error)),
          stderr: '',
        };
      }
      throw error;
    }
  }
  return spawnRunner(verb, target, stateSchema, options);
}

function spawnRunner(
  verb: TransformVerb,
  target: TransformTarget,
  stateSchema: string | undefined,
  options: TransformJobOptions,
): Promise<TransformJobRun> {
  const terminal = options.output === 'terminal';
  return new Promise((resolve, reject) => {
    const child = spawn(
      'uv',
      ['run', '--frozen', '--offline', 'python', '-m', 'runner', verb, '--json'],
      {
        cwd: TRANSFORM_PACKAGE_DIRECTORY,
        env: {
          ...childEnvironment(target, stateSchema),
          ATLASBI_TRANSFORM_PROJECT: options.projectDirectory ?? SQLMESH_PROJECT_DIRECTORY,
          ...(options.debug === true ? { ATLASBI_TRANSFORM_DEBUG: '1' } : {}),
        },
        // stdout is never redirected to a null device: on Windows the tool then exits 1 silently.
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
        const summary = parseTransformSummary(JSON.parse(line) as unknown);
        if (summary.exitCode !== (code ?? 1)) {
          throw new Error(`exit code ${code ?? 'none'} differs from the summary's`);
        }
        resolve({ summary, stderr });
      } catch (error) {
        // A runner that crashed before its summary is an internal error, not a parse failure.
        resolve({
          summary: transformFailure(verb, new Date().toISOString(), {
            code: 'internal_error',
            message: `The transformation runner stopped without a valid summary (exit ${code ?? 'none'}): ${
              error instanceof Error ? error.message : String(error)
            }. Run it again with ATLASBI_TRANSFORM_DEBUG=1 to see the trace.`,
          }),
          stderr,
        });
      }
    });
  });
}

/**
 * The summary of a run that failed before the runner could answer — a usage or configuration error
 * of its caller, a lakehouse that does not open — so every outcome has one, whoever stopped it.
 */
export function transformFailure(
  verb: string,
  startedAt: string,
  error: { code: TransformErrorCode; message: string },
): TransformJobSummary {
  const exitCode = transformExitCodeFor(error.code);
  return {
    jobVersion: TRANSFORM_JOB_VERSION,
    verb,
    status: 'failed',
    exitCode,
    retryable: exitCode === 75,
    startedAt,
    finishedAt: new Date().toISOString(),
    models: [],
    error,
  };
}
