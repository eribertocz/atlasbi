import type { MaintenancePolicy } from '../lakehouse/lakehouse-admin-port.ts';
import {
  asRecord,
  isCount,
  type JobEnvelope,
  type JobExitCode,
  parseJobEnvelope,
  SHARED_EXIT_CODE_BY_ERROR,
  SHARED_JOB_ERROR_CODES,
  type SharedJobErrorCode,
} from './job-summary.ts';

/**
 * The lakehouse maintenance job — `pnpm lakehouse maintain` (Plan C, docs/01 §6.8, docs/07 §7.1):
 * retention, explicit and configurable. Versioned on its own, on the envelope every job shares.
 */
export const LAKEHOUSE_MAINTENANCE_JOB_VERSION = '1.0';

/** It meets no failure of its own: the lakehouse's are the shared ones. */
export const LAKEHOUSE_MAINTENANCE_ERROR_CODES = SHARED_JOB_ERROR_CODES;

export type LakehouseMaintenanceErrorCode = SharedJobErrorCode;

export function lakehouseMaintenanceExitCodeFor(error: LakehouseMaintenanceErrorCode): JobExitCode {
  return SHARED_EXIT_CODE_BY_ERROR[error];
}

export interface LakehouseMaintenanceSummary extends JobEnvelope<LakehouseMaintenanceErrorCode> {
  jobVersion: typeof LAKEHOUSE_MAINTENANCE_JOB_VERSION;
  /** Nothing was changed: the numbers say what a real run would do. */
  dryRun: boolean;
  /** The policy applied; null when the job stopped before it had one. */
  policy: MaintenancePolicy | null;
  expiredSnapshots: number;
  deletedFiles: number;
  deletedOrphans: number;
  compactedTables: number;
  /** For a person: what the numbers alone would hide. */
  notes: readonly string[];
}

export class InvalidLakehouseMaintenanceSummaryError extends Error {
  constructor(reason: string) {
    super(`Invalid lakehouse maintenance summary: ${reason}`);
    this.name = 'InvalidLakehouseMaintenanceSummaryError';
  }
}

const fail = (reason: string) => new InvalidLakehouseMaintenanceSummaryError(reason);

export function parseLakehouseMaintenanceSummary(value: unknown): LakehouseMaintenanceSummary {
  const summary = asRecord(value);
  if (summary === undefined) {
    throw fail('not an object');
  }
  if (summary.jobVersion !== LAKEHOUSE_MAINTENANCE_JOB_VERSION) {
    throw fail(`jobVersion is not ${LAKEHOUSE_MAINTENANCE_JOB_VERSION}`);
  }
  const envelope = parseJobEnvelope(
    summary,
    { codes: LAKEHOUSE_MAINTENANCE_ERROR_CODES, exitCodeFor: lakehouseMaintenanceExitCodeFor },
    fail,
  );
  const { dryRun, expiredSnapshots, deletedFiles, deletedOrphans, compactedTables, notes } =
    summary;
  if (
    typeof dryRun !== 'boolean' ||
    !isCount(expiredSnapshots) ||
    !isCount(deletedFiles) ||
    !isCount(deletedOrphans) ||
    !isCount(compactedTables) ||
    !Array.isArray(notes) ||
    !notes.every((note) => typeof note === 'string')
  ) {
    throw fail('dryRun, the four counts and notes are required');
  }
  const policy = summary.policy === null ? null : asRecord(summary.policy);
  if (
    policy === undefined ||
    (policy !== null &&
      (!isCount(policy.snapshotRetentionDays) ||
        !isCount(policy.cleanupGraceMinutes) ||
        !isCount(policy.orphanGraceHours)))
  ) {
    throw fail(
      'policy must be null or { snapshotRetentionDays, cleanupGraceMinutes, orphanGraceHours }',
    );
  }
  return {
    jobVersion: LAKEHOUSE_MAINTENANCE_JOB_VERSION,
    ...envelope,
    dryRun,
    policy:
      policy === null
        ? null
        : {
            snapshotRetentionDays: policy.snapshotRetentionDays as number,
            cleanupGraceMinutes: policy.cleanupGraceMinutes as number,
            orphanGraceHours: policy.orphanGraceHours as number,
          },
    expiredSnapshots,
    deletedFiles,
    deletedOrphans,
    compactedTables,
    notes,
  };
}
