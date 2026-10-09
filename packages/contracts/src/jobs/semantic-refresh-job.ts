import {
  asRecord,
  JOB_EXIT_CODES,
  type JobEnvelope,
  type JobExitCode,
  parseJobEnvelope,
  SHARED_EXIT_CODE_BY_ERROR,
  SHARED_JOB_ERROR_CODES,
} from './job-summary.ts';

/**
 * The semantic refresh job — `pnpm semantic refresh` (Plan C, docs/07 §7.1): rebuild what the
 * semantic layer keeps precomputed, after transformation published new data. Versioned on its own,
 * on the envelope every job shares (job-summary.ts).
 */
export const SEMANTIC_REFRESH_JOB_VERSION = '1.0';

export const SEMANTIC_REFRESH_ERROR_CODES = [
  ...SHARED_JOB_ERROR_CODES,
  /** The semantic layer does not answer, or did not finish in time. */
  'semantic_unavailable',
  /** The semantic layer answered, and could not build one of its precomputed results. */
  'build_failed',
] as const;

export type SemanticRefreshErrorCode = (typeof SEMANTIC_REFRESH_ERROR_CODES)[number];

const EXIT_CODE_BY_ERROR: Record<SemanticRefreshErrorCode, JobExitCode> = {
  ...SHARED_EXIT_CODE_BY_ERROR,
  /* eslint-disable @typescript-eslint/naming-convention -- the error codes are the contract's wire format. */
  semantic_unavailable: JOB_EXIT_CODES.retryable,
  build_failed: JOB_EXIT_CODES.dataError,
  /* eslint-enable @typescript-eslint/naming-convention */
};

export function semanticRefreshExitCodeFor(error: SemanticRefreshErrorCode): JobExitCode {
  return EXIT_CODE_BY_ERROR[error];
}

/** One precomputed result the refresh rebuilt, or failed to. */
export interface SemanticRefreshBuild {
  /** `cube.name`, as the semantic model names it. */
  name: string;
  status: 'built' | 'failed';
}

export interface SemanticRefreshSummary extends JobEnvelope<SemanticRefreshErrorCode> {
  jobVersion: typeof SEMANTIC_REFRESH_JOB_VERSION;
  builds: readonly SemanticRefreshBuild[];
}

export class InvalidSemanticRefreshSummaryError extends Error {
  constructor(reason: string) {
    super(`Invalid semantic refresh summary: ${reason}`);
    this.name = 'InvalidSemanticRefreshSummaryError';
  }
}

const fail = (reason: string) => new InvalidSemanticRefreshSummaryError(reason);

export function parseSemanticRefreshSummary(value: unknown): SemanticRefreshSummary {
  const summary = asRecord(value);
  if (summary === undefined) {
    throw fail('not an object');
  }
  if (summary.jobVersion !== SEMANTIC_REFRESH_JOB_VERSION) {
    throw fail(`jobVersion is not ${SEMANTIC_REFRESH_JOB_VERSION}`);
  }
  const envelope = parseJobEnvelope(
    summary,
    { codes: SEMANTIC_REFRESH_ERROR_CODES, exitCodeFor: semanticRefreshExitCodeFor },
    fail,
  );
  const builds = (Array.isArray(summary.builds) ? summary.builds : []).map(
    (item): SemanticRefreshBuild => {
      const build = asRecord(item);
      if (
        build === undefined ||
        typeof build.name !== 'string' ||
        (build.status !== 'built' && build.status !== 'failed')
      ) {
        throw fail('a build must be { name, status: built | failed }');
      }
      return { name: build.name, status: build.status };
    },
  );
  return { jobVersion: SEMANTIC_REFRESH_JOB_VERSION, ...envelope, builds };
}
