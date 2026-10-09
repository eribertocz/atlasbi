import {
  asRecord,
  isCount,
  JOB_EXIT_CODES,
  type JobEnvelope,
  type JobExitCode,
  parseJobEnvelope,
  SHARED_EXIT_CODE_BY_ERROR,
} from './job-summary.ts';

/**
 * The ingestion job — `pnpm ingest <source>` (docs/03): what any caller gets back from it, a person
 * or the orchestrator of build step 8, whatever tool extracts the data. Versioned on its own, on
 * the envelope every job shares (job-summary.ts).
 */
export const INGEST_JOB_VERSION = '1.0';

/** The jobs' exit codes (job-summary.ts), under the name this contract was published with. */
export const INGEST_EXIT_CODES = JOB_EXIT_CODES;

export type IngestExitCode = JobExitCode;

/**
 * Why a run failed, in the platform's words — never a tool's exception or message. Published in 1.0
 * in this order; it holds every code all jobs share (a unit test keeps it so).
 */
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

const EXIT_CODE_BY_ERROR: Record<IngestErrorCode, IngestExitCode> = {
  ...SHARED_EXIT_CODE_BY_ERROR,
  /* eslint-disable @typescript-eslint/naming-convention -- the error codes are the contract's wire format. */
  source_unavailable: JOB_EXIT_CODES.retryable,
  schema_change: JOB_EXIT_CODES.dataError,
  contract_violation: JOB_EXIT_CODES.dataError,
  /* eslint-enable @typescript-eslint/naming-convention */
};

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

export interface IngestSummary extends JobEnvelope<IngestErrorCode> {
  jobVersion: typeof INGEST_JOB_VERSION;
  source: string;
  loads: readonly IngestLoad[];
  landing: readonly IngestLanding[];
}

export class InvalidIngestSummaryError extends Error {
  constructor(reason: string) {
    super(`Invalid ingestion summary: ${reason}`);
    this.name = 'InvalidIngestSummaryError';
  }
}

const fail = (reason: string) => new InvalidIngestSummaryError(reason);

/** Validates what the ingestion runner printed; whatever does not fit the contract is refused. */
export function parseIngestSummary(value: unknown): IngestSummary {
  const summary = asRecord(value);
  if (summary === undefined) {
    throw fail('not an object');
  }
  if (summary.jobVersion !== INGEST_JOB_VERSION) {
    throw fail(`jobVersion is not ${INGEST_JOB_VERSION}`);
  }
  if (typeof summary.source !== 'string') {
    throw fail('source and status are required');
  }
  const envelope = parseJobEnvelope(summary, { codes: INGEST_ERROR_CODES, exitCodeFor }, fail);
  const loads = (Array.isArray(summary.loads) ? summary.loads : []).map((item) => {
    const load = asRecord(item);
    if (
      load === undefined ||
      typeof load.entity !== 'string' ||
      typeof load.partition !== 'string' ||
      !(typeof load.loadId === 'string' || load.loadId === null) ||
      !isCount(load.rows)
    ) {
      throw fail('a load has the wrong shape');
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
      throw fail('a landing entry has the wrong shape');
    }
    return {
      table: { schema: table.schema, name: table.name },
      rowsAdded: entry.rowsAdded,
      rowsTotal: entry.rowsTotal,
    };
  });
  return {
    jobVersion: INGEST_JOB_VERSION,
    source: summary.source,
    ...envelope,
    loads,
    landing,
  };
}
