import type { LakehouseError } from '../lakehouse/lakehouse-error.ts';

/**
 * What every platform job shares (docs/07 §7.1) — `pnpm ingest`, `pnpm transform <verb>`… —
 * whatever tool does the work: the exit codes, the error codes no job can do without, and the
 * envelope of its summary. Each job versions its own summary on top of it.
 */

/**
 * Exit codes, after sysexits(3). Only `retryable` is worth running again unchanged; every other
 * failure needs a person — or a change — first.
 */
export const JOB_EXIT_CODES = {
  succeeded: 0,
  usage: 64,
  dataError: 65,
  internal: 70,
  retryable: 75,
  credentialsRefused: 77,
  configuration: 78,
} as const;

export type JobExitCode = (typeof JOB_EXIT_CODES)[keyof typeof JOB_EXIT_CODES];

/** The failures every job can meet, in the platform's words — never a tool's message. */
export const SHARED_JOB_ERROR_CODES = [
  'usage_error',
  'configuration_error',
  'credentials_refused',
  'catalog_unavailable',
  'storage_unavailable',
  'internal_error',
] as const;

export type SharedJobErrorCode = (typeof SHARED_JOB_ERROR_CODES)[number];

export const SHARED_EXIT_CODE_BY_ERROR: Record<SharedJobErrorCode, JobExitCode> = {
  /* eslint-disable @typescript-eslint/naming-convention -- the error codes are the contract's wire format. */
  usage_error: JOB_EXIT_CODES.usage,
  configuration_error: JOB_EXIT_CODES.configuration,
  credentials_refused: JOB_EXIT_CODES.credentialsRefused,
  catalog_unavailable: JOB_EXIT_CODES.retryable,
  storage_unavailable: JOB_EXIT_CODES.retryable,
  internal_error: JOB_EXIT_CODES.internal,
  /* eslint-enable @typescript-eslint/naming-convention */
};

export interface JobError<Code extends string> {
  code: Code;
  message: string;
}

/** The fields every job summary starts with. */
export interface JobEnvelope<Code extends string> {
  status: 'succeeded' | 'failed';
  exitCode: JobExitCode;
  /** True exactly when exitCode is `retryable`. */
  retryable: boolean;
  startedAt: string;
  finishedAt: string;
  error?: JobError<Code>;
}

export interface JobVocabulary<Code extends string> {
  codes: readonly Code[];
  exitCodeFor(code: Code): JobExitCode;
}

const EXIT_CODES: readonly number[] = Object.values(JOB_EXIT_CODES);

/**
 * Validates the envelope of a summary a job printed: status, exit code, retryable flag and error
 * code must all agree, or the summary is refused with `fail`.
 */
export function parseJobEnvelope<Code extends string>(
  summary: Record<string, unknown>,
  vocabulary: JobVocabulary<Code>,
  fail: (reason: string) => Error,
): JobEnvelope<Code> {
  const { status, exitCode, retryable, startedAt, finishedAt } = summary;
  if (status !== 'succeeded' && status !== 'failed') {
    throw fail('status is required');
  }
  if (typeof exitCode !== 'number' || !EXIT_CODES.includes(exitCode)) {
    throw fail(`exitCode ${String(exitCode)} is not a job exit code`);
  }
  if ((status === 'succeeded') !== (exitCode === JOB_EXIT_CODES.succeeded)) {
    throw fail('status and exitCode disagree');
  }
  if (retryable !== (exitCode === JOB_EXIT_CODES.retryable)) {
    throw fail('retryable must be true exactly for the retryable exit code');
  }
  if (typeof startedAt !== 'string' || typeof finishedAt !== 'string') {
    throw fail('startedAt and finishedAt are required');
  }
  const error =
    summary.error === undefined
      ? undefined
      : parseJobError(summary.error, exitCode, vocabulary, fail);
  if ((error === undefined) !== (status === 'succeeded')) {
    throw fail('a failed run says why; a successful one has no error');
  }
  return {
    status,
    exitCode: exitCode as JobExitCode,
    retryable,
    startedAt,
    finishedAt,
    ...(error === undefined ? {} : { error }),
  };
}

function parseJobError<Code extends string>(
  value: unknown,
  exitCode: number,
  vocabulary: JobVocabulary<Code>,
  fail: (reason: string) => Error,
): JobError<Code> {
  const error = asRecord(value);
  const code = error?.code;
  if (
    error === undefined ||
    !vocabulary.codes.includes(code as Code) ||
    typeof error.message !== 'string'
  ) {
    throw fail('error must be { code, message } with a known code');
  }
  if (vocabulary.exitCodeFor(code as Code) !== exitCode) {
    throw fail(`error ${String(code)} does not go with exit code ${exitCode}`);
  }
  return { code: code as Code, message: error.message };
}

/**
 * What a lakehouse that fails to open means for any job that writes to it, in the job's terms. The
 * warehouse gives a refused password and a missing database the same code; its own message — never
 * the engine's — tells them apart, and the integration tests of each job pin both.
 */
export function jobErrorForLakehouseFailure(error: LakehouseError): JobError<SharedJobErrorCode> {
  const message = error.remedy === undefined ? error.message : `${error.message} ${error.remedy}`;
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

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
