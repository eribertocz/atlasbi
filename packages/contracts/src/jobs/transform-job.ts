import {
  asRecord,
  isCount,
  JOB_EXIT_CODES,
  type JobEnvelope,
  type JobExitCode,
  parseJobEnvelope,
  SHARED_EXIT_CODE_BY_ERROR,
  SHARED_JOB_ERROR_CODES,
} from './job-summary.ts';

/**
 * The transformation job — `pnpm transform <verb>` (docs/02 §6.5, docs/07 §7.1): what the
 * orchestrator, CI or a studio gets back, whatever tool transforms the data. Versioned on its own,
 * on the envelope every job shares (job-summary.ts).
 */
export const TRANSFORM_JOB_VERSION = '1.0';

/**
 * - `run`: the daily execution — the pending intervals of the deployed models.
 * - `deploy`: the models as they are in the repository become the ones that run (CI/CD).
 * - `test`: the models' unit tests, without a lakehouse.
 * - `check`: the project's rules (lint) and the data's (audits).
 */
export const TRANSFORM_VERBS = ['run', 'deploy', 'test', 'check'] as const;

export type TransformVerb = (typeof TRANSFORM_VERBS)[number];

export const TRANSFORM_ERROR_CODES = [
  ...SHARED_JOB_ERROR_CODES,
  /** The transformation's own state database does not answer. */
  'state_unavailable',
  /** A model breaks the project's rules: lint, or a reference that does not exist. */
  'model_invalid',
  /** A model failed while it ran. */
  'model_failed',
  /** The data a model produced fails one of its audits. */
  'audit_failed',
  'test_failed',
] as const;

export type TransformErrorCode = (typeof TRANSFORM_ERROR_CODES)[number];

const EXIT_CODE_BY_ERROR: Record<TransformErrorCode, JobExitCode> = {
  ...SHARED_EXIT_CODE_BY_ERROR,
  /* eslint-disable @typescript-eslint/naming-convention -- the error codes are the contract's wire format. */
  state_unavailable: JOB_EXIT_CODES.retryable,
  model_invalid: JOB_EXIT_CODES.dataError,
  model_failed: JOB_EXIT_CODES.dataError,
  audit_failed: JOB_EXIT_CODES.dataError,
  test_failed: JOB_EXIT_CODES.dataError,
  /* eslint-enable @typescript-eslint/naming-convention */
};

export function transformExitCodeFor(error: TransformErrorCode): JobExitCode {
  return EXIT_CODE_BY_ERROR[error];
}

/** One model the run evaluated. */
export interface TransformModelResult {
  /** `schema.table`, as the lakehouse names what the model publishes. */
  model: string;
  /** How many intervals of it were evaluated. */
  intervals: number;
  /** Null when the tool did not say. */
  durationMs: number | null;
  auditsPassed: number;
  auditsFailed: number;
  failed: boolean;
}

export interface TransformJobSummary extends JobEnvelope<TransformErrorCode> {
  jobVersion: typeof TRANSFORM_JOB_VERSION;
  /** One of TRANSFORM_VERBS — or, with `usage_error`, whatever the caller typed. */
  verb: string;
  /** `run` and `deploy`: the models evaluated, none when nothing was pending. */
  models: readonly TransformModelResult[];
  /** `deploy`: whether anything changed, and the models that did. */
  changes?: { changed: boolean; models: readonly string[] };
  /** `test`: the unit tests run, and how many failed. */
  tests?: { run: number; failed: number };
  /** `check`: every lint violation. */
  lint?: readonly { rule: string; model: string }[];
  /** `check`: whether every audit passed. */
  audits?: { passed: boolean };
}

export class InvalidTransformSummaryError extends Error {
  constructor(reason: string) {
    super(`Invalid transformation summary: ${reason}`);
    this.name = 'InvalidTransformSummaryError';
  }
}

const fail = (reason: string) => new InvalidTransformSummaryError(reason);

/** Validates what the transformation runner printed; whatever does not fit is refused. */
export function parseTransformSummary(value: unknown): TransformJobSummary {
  const summary = asRecord(value);
  if (summary === undefined) {
    throw fail('not an object');
  }
  if (summary.jobVersion !== TRANSFORM_JOB_VERSION) {
    throw fail(`jobVersion is not ${TRANSFORM_JOB_VERSION}`);
  }
  const envelope = parseJobEnvelope(
    summary,
    { codes: TRANSFORM_ERROR_CODES, exitCodeFor: transformExitCodeFor },
    fail,
  );
  const verb = summary.verb;
  if (
    typeof verb !== 'string' ||
    (envelope.error?.code !== 'usage_error' && !TRANSFORM_VERBS.includes(verb as TransformVerb))
  ) {
    throw fail(`verb ${String(verb)} is not one of ${TRANSFORM_VERBS.join(', ')}`);
  }
  const models = (Array.isArray(summary.models) ? summary.models : []).map((item) => {
    const model = asRecord(item);
    if (
      model === undefined ||
      typeof model.model !== 'string' ||
      !isCount(model.intervals) ||
      !(model.durationMs === null || isCount(model.durationMs)) ||
      !isCount(model.auditsPassed) ||
      !isCount(model.auditsFailed) ||
      typeof model.failed !== 'boolean'
    ) {
      throw fail('a model result has the wrong shape');
    }
    return {
      model: model.model,
      intervals: model.intervals,
      durationMs: model.durationMs,
      auditsPassed: model.auditsPassed,
      auditsFailed: model.auditsFailed,
      failed: model.failed,
    };
  });
  return {
    jobVersion: TRANSFORM_JOB_VERSION,
    verb,
    ...envelope,
    models,
    ...optional('changes', summary.changes, (changes) => {
      const record = asRecord(changes);
      if (
        record === undefined ||
        typeof record.changed !== 'boolean' ||
        !Array.isArray(record.models) ||
        !record.models.every((model) => typeof model === 'string')
      ) {
        throw fail('changes must be { changed, models }');
      }
      return { changed: record.changed, models: record.models };
    }),
    ...optional('tests', summary.tests, (tests) => {
      const record = asRecord(tests);
      if (record === undefined || !isCount(record.run) || !isCount(record.failed)) {
        throw fail('tests must be { run, failed }');
      }
      return { run: record.run, failed: record.failed };
    }),
    ...optional('lint', summary.lint, (lint) => {
      if (!Array.isArray(lint)) {
        throw fail('lint must be a list');
      }
      return lint.map((item) => {
        const violation = asRecord(item);
        if (
          violation === undefined ||
          typeof violation.rule !== 'string' ||
          typeof violation.model !== 'string'
        ) {
          throw fail('a lint violation must be { rule, model }');
        }
        return { rule: violation.rule, model: violation.model };
      });
    }),
    ...optional('audits', summary.audits, (audits) => {
      const record = asRecord(audits);
      if (record === undefined || typeof record.passed !== 'boolean') {
        throw fail('audits must be { passed }');
      }
      return { passed: record.passed };
    }),
  };
}

function optional<Key extends string, Value>(
  key: Key,
  value: unknown,
  parse: (value: unknown) => Value,
): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: parse(value) } as Record<Key, Value>);
}
