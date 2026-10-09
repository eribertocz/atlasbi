/**
 * The ingestion job — `pnpm ingest <source>` (docs/03): what any caller gets back from it, a person
 * or the orchestrator of build step 8, whatever tool extracts the data. Versioned on its own.
 */
export const INGEST_JOB_VERSION = '1.0';

/**
 * Exit codes, after sysexits(3). Only `retryable` is worth running again unchanged: the load that
 * failed is resumed, never duplicated.
 */
export const INGEST_EXIT_CODES = {
  succeeded: 0,
  usage: 64,
  dataError: 65,
  internal: 70,
  retryable: 75,
  credentialsRefused: 77,
  configuration: 78,
} as const;

export type IngestExitCode = (typeof INGEST_EXIT_CODES)[keyof typeof INGEST_EXIT_CODES];

/** Why a run failed, in the platform's words — never a tool's exception or message. */
export const INGEST_ERROR_CODES = [
  'usage_error',
  'configuration_error',
  'credentials_refused',
  'source_unavailable',
  'catalog_unavailable',
  'storage_unavailable',
  'schema_change',
  'contract_violation',
  'internal_error',
] as const;

export type IngestErrorCode = (typeof INGEST_ERROR_CODES)[number];

/* eslint-disable @typescript-eslint/naming-convention -- the error codes are the contract's wire format. */
const EXIT_CODE_BY_ERROR: Record<IngestErrorCode, IngestExitCode> = {
  usage_error: INGEST_EXIT_CODES.usage,
  configuration_error: INGEST_EXIT_CODES.configuration,
  credentials_refused: INGEST_EXIT_CODES.credentialsRefused,
  source_unavailable: INGEST_EXIT_CODES.retryable,
  catalog_unavailable: INGEST_EXIT_CODES.retryable,
  storage_unavailable: INGEST_EXIT_CODES.retryable,
  schema_change: INGEST_EXIT_CODES.dataError,
  contract_violation: INGEST_EXIT_CODES.dataError,
  internal_error: INGEST_EXIT_CODES.internal,
};
/* eslint-enable @typescript-eslint/naming-convention */

export function exitCodeFor(error: IngestErrorCode): IngestExitCode {
  return EXIT_CODE_BY_ERROR[error];
}

/** One load of one part of the source — a repository, an account… */
export interface IngestLoad {
  entity: string;
  partition: string;
  /** Opaque; the `_load_id` its rows carry in the landing. Null when there was nothing new. */
  loadId: string | null;
  rows: number;
}

/** A landing table the run published (docs/21 §2.4), with what it holds after the run. */
export interface IngestLanding {
  table: { schema: string; name: string };
  rowsAdded: number;
  rowsTotal: number;
}

export interface IngestSummary {
  jobVersion: typeof INGEST_JOB_VERSION;
  source: string;
  status: 'succeeded' | 'failed';
  exitCode: IngestExitCode;
  /** True exactly when exitCode is `retryable`. */
  retryable: boolean;
  startedAt: string;
  finishedAt: string;
  loads: readonly IngestLoad[];
  landing: readonly IngestLanding[];
  error?: { code: IngestErrorCode; message: string };
}

export class InvalidIngestSummaryError extends Error {
  constructor(reason: string) {
    super(`Invalid ingestion summary: ${reason}`);
    this.name = 'InvalidIngestSummaryError';
  }
}

const EXIT_CODES: readonly number[] = Object.values(INGEST_EXIT_CODES);

/** Validates what the ingestion runner printed; whatever does not fit the contract is refused. */
export function parseIngestSummary(value: unknown): IngestSummary {
  const summary = asRecord(value);
  if (summary === undefined) {
    throw new InvalidIngestSummaryError('not an object');
  }
  if (summary.jobVersion !== INGEST_JOB_VERSION) {
    throw new InvalidIngestSummaryError(`jobVersion is not ${INGEST_JOB_VERSION}`);
  }
  const { source, status, exitCode, retryable, startedAt, finishedAt } = summary;
  if (typeof source !== 'string' || (status !== 'succeeded' && status !== 'failed')) {
    throw new InvalidIngestSummaryError('source and status are required');
  }
  if (typeof exitCode !== 'number' || !EXIT_CODES.includes(exitCode)) {
    throw new InvalidIngestSummaryError(
      `exitCode ${String(exitCode)} is not an ingestion exit code`,
    );
  }
  if ((status === 'succeeded') !== (exitCode === INGEST_EXIT_CODES.succeeded)) {
    throw new InvalidIngestSummaryError('status and exitCode disagree');
  }
  if (retryable !== (exitCode === INGEST_EXIT_CODES.retryable)) {
    throw new InvalidIngestSummaryError(
      'retryable must be true exactly for the retryable exit code',
    );
  }
  if (typeof startedAt !== 'string' || typeof finishedAt !== 'string') {
    throw new InvalidIngestSummaryError('startedAt and finishedAt are required');
  }
  const loads = (Array.isArray(summary.loads) ? summary.loads : []).map((item) => {
    const load = asRecord(item);
    if (
      load === undefined ||
      typeof load.entity !== 'string' ||
      typeof load.partition !== 'string' ||
      !(typeof load.loadId === 'string' || load.loadId === null) ||
      !isCount(load.rows)
    ) {
      throw new InvalidIngestSummaryError('a load has the wrong shape');
    }
    return { entity: load.entity, partition: load.partition, loadId: load.loadId, rows: load.rows };
  });
  const landing = (Array.isArray(summary.landing) ? summary.landing : []).map((item) => {
    const entry = asRecord(item);
    const table = asRecord(entry?.table);
    if (
      entry === undefined ||
      table === undefined ||
      typeof table.schema !== 'string' ||
      typeof table.name !== 'string' ||
      !isCount(entry.rowsAdded) ||
      !isCount(entry.rowsTotal)
    ) {
      throw new InvalidIngestSummaryError('a landing entry has the wrong shape');
    }
    return {
      table: { schema: table.schema, name: table.name },
      rowsAdded: entry.rowsAdded,
      rowsTotal: entry.rowsTotal,
    };
  });
  const error = summary.error === undefined ? undefined : parseError(summary.error, exitCode);
  if ((error === undefined) !== (status === 'succeeded')) {
    throw new InvalidIngestSummaryError('a failed run says why; a successful one has no error');
  }
  return {
    jobVersion: INGEST_JOB_VERSION,
    source,
    status,
    exitCode: exitCode as IngestExitCode,
    retryable,
    startedAt,
    finishedAt,
    loads,
    landing,
    ...(error === undefined ? {} : { error }),
  };
}

function parseError(value: unknown, exitCode: number): { code: IngestErrorCode; message: string } {
  const error = asRecord(value);
  const code = error?.code;
  if (
    error === undefined ||
    !INGEST_ERROR_CODES.includes(code as IngestErrorCode) ||
    typeof error.message !== 'string'
  ) {
    throw new InvalidIngestSummaryError('error must be { code, message } with a known code');
  }
  if (exitCodeFor(code as IngestErrorCode) !== exitCode) {
    throw new InvalidIngestSummaryError(
      `error ${String(code)} does not go with exit code ${exitCode}`,
    );
  }
  return { code: code as IngestErrorCode, message: error.message };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
