import { styleText } from 'node:util';

import {
  assertSecretsAvailable,
  ConfigurationError,
  createSecretProvider,
  lakehouseWriterSecretKeys,
  loadConfig,
} from '@atlasbi/config';
import {
  jobErrorForLakehouseFailure,
  LAKEHOUSE_MAINTENANCE_JOB_VERSION,
  LakehouseError,
  type LakehouseMaintenanceErrorCode,
  type LakehouseMaintenanceSummary,
  lakehouseMaintenanceExitCodeFor,
  maintenancePolicyIssues,
  type MaintenancePolicy,
  type MaintenanceReport,
  MIN_ORPHAN_GRACE_HOURS,
} from '@atlasbi/contracts';
import { createLakehouseAdmin } from '@atlasbi/warehouse';

import { JobStopped, reportJob } from '../jobs/run-job.ts';
import { describeFailure, resolveLakehouseSettings } from '../lakehouse-environment.ts';
import { loadEnvFile, MissingEnvFileError } from '../local-environment.ts';
import {
  CONFIRM_FLAG,
  ConfirmationRequiredError,
  confirmByTyping,
} from '../system/confirmation.ts';
import { WORKSPACE_ROOT } from '../workspace-paths.ts';

const ORPHAN_GRACE_FLAG = '--orphan-grace-hours=';

const USAGE =
  `Usage: pnpm lakehouse maintain [--dry-run] [${ORPHAN_GRACE_FLAG}<hours>] [${CONFIRM_FLAG}] [--json]\n` +
  '  Expires versions older than the retention, deletes the files only they used and the orphans\n' +
  '  past their grace, and compacts small files (docs/01 §6.8). --dry-run changes nothing.\n' +
  `  The orphan grace is never under ${MIN_ORPHAN_GRACE_HOURS} hour(s). Outside development, a real run asks for ${CONFIRM_FLAG}.`;

/**
 * The lakehouse maintenance job (Plan C): retention, explicit and configurable — every outcome
 * ends in a summary and its exit code, `--json` printing the summary alone on stdout.
 */
export async function runLakehouse(args: readonly string[]): Promise<void> {
  if (args[0] === undefined || args[0] === '--help') {
    console.log(USAGE);
    return;
  }
  const startedAt = new Date().toISOString();
  const json = args.includes('--json');
  const dryRun = args.includes('--dry-run');
  let policy: MaintenancePolicy | null = null;
  let summary: LakehouseMaintenanceSummary;
  try {
    const orphanGraceHours = parseArguments(args);
    const { policy: configured, environment, settings } = await maintenanceTarget();
    policy = { ...configured, ...(orphanGraceHours === undefined ? {} : { orphanGraceHours }) };
    const issues = maintenancePolicyIssues(policy);
    if (issues.length > 0) {
      throw new JobStopped(
        orphanGraceHours === undefined ? 'configuration_error' : 'usage_error',
        `The maintenance policy cannot be used: ${issues.join('; ')}.`,
      );
    }
    if (!dryRun && environment !== 'development') {
      const confirmed = await confirmByTyping(
        args,
        `This ${environment} lakehouse is about to lose every version older than ${policy.snapshotRetentionDays} day(s), and the files only they used.`,
      );
      if (!confirmed) {
        throw new JobStopped('usage_error', 'Not confirmed — nothing was changed.');
      }
    }
    console.error(
      styleText('gray', dryRun ? 'Lakehouse maintenance · dry run' : 'Lakehouse maintenance'),
    );
    const admin = await createLakehouseAdmin(settings);
    let report: MaintenanceReport;
    try {
      report = await admin.maintain(policy, { dryRun });
    } finally {
      await admin.close();
    }
    summary = maintenanceSummary(startedAt, policy, report);
    describeReport(summary);
  } catch (error) {
    summary = maintenanceFailure(startedAt, dryRun, policy, failureOf(error));
  }
  reportJob(dryRun ? 'Lakehouse maintenance (dry run)' : 'Lakehouse maintenance', summary, json);
}

/** The orphan grace given on the command line, if any; every other argument must be known. */
function parseArguments(args: readonly string[]): number | undefined {
  const known = (arg: string) =>
    arg === 'maintain' ||
    arg === '--json' ||
    arg === '--dry-run' ||
    arg === CONFIRM_FLAG ||
    arg.startsWith(ORPHAN_GRACE_FLAG);
  if (
    args[0] !== 'maintain' ||
    args.filter((arg) => arg === 'maintain').length !== 1 ||
    !args.every(known)
  ) {
    throw new JobStopped('usage_error', USAGE);
  }
  const grace = args.find((arg) => arg.startsWith(ORPHAN_GRACE_FLAG));
  if (grace === undefined) {
    return undefined;
  }
  const hours = Number(grace.slice(ORPHAN_GRACE_FLAG.length));
  if (!Number.isInteger(hours) || hours < MIN_ORPHAN_GRACE_HOURS) {
    throw new JobStopped(
      'usage_error',
      `${ORPHAN_GRACE_FLAG}<hours> must be a whole number, at least ${MIN_ORPHAN_GRACE_HOURS}: a shorter grace deletes files writers have not committed yet, and their tables lose data.`,
    );
  }
  return hours;
}

async function maintenanceTarget() {
  try {
    loadEnvFile();
    const config = loadConfig(process.env, { baseDirectory: WORKSPACE_ROOT });
    const secrets = createSecretProvider(config);
    await assertSecretsAvailable(secrets, lakehouseWriterSecretKeys(config.lakehouse));
    return {
      policy: config.lakehouse.retention,
      environment: config.environment,
      settings: await resolveLakehouseSettings(config.lakehouse, secrets),
    };
  } catch (error) {
    if (error instanceof ConfigurationError || error instanceof MissingEnvFileError) {
      throw new JobStopped('configuration_error', error.message);
    }
    throw error;
  }
}

/** For a person, with the summary: what the counts alone would hide (decision N5). */
export function notesFor(policy: MaintenancePolicy, dryRun: boolean): string[] {
  const deferred =
    `Files freed by expiring versions or compacting today are not deleted today: they are deleted by the next run, once the ${policy.cleanupGraceMinutes}-minute cleanup grace has passed` +
    (dryRun
      ? ' — so this dry run cannot count them, and a 0 here does not mean there is nothing to delete.'
      : '.');
  return dryRun ? ['Dry run: nothing was changed.', deferred] : [deferred];
}

function maintenanceSummary(
  startedAt: string,
  policy: MaintenancePolicy,
  report: MaintenanceReport,
): LakehouseMaintenanceSummary {
  return {
    jobVersion: LAKEHOUSE_MAINTENANCE_JOB_VERSION,
    status: 'succeeded',
    exitCode: 0,
    retryable: false,
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun: report.dryRun,
    policy,
    expiredSnapshots: report.expiredSnapshots,
    deletedFiles: report.deletedFiles,
    deletedOrphans: report.deletedOrphans,
    compactedTables: report.compactedTables,
    notes: notesFor(policy, report.dryRun),
  };
}

function maintenanceFailure(
  startedAt: string,
  dryRun: boolean,
  policy: MaintenancePolicy | null,
  error: { code: LakehouseMaintenanceErrorCode; message: string },
): LakehouseMaintenanceSummary {
  const exitCode = lakehouseMaintenanceExitCodeFor(error.code);
  return {
    jobVersion: LAKEHOUSE_MAINTENANCE_JOB_VERSION,
    status: 'failed',
    exitCode,
    retryable: exitCode === 75,
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun,
    policy,
    expiredSnapshots: 0,
    deletedFiles: 0,
    deletedOrphans: 0,
    compactedTables: 0,
    notes: [],
    error,
  };
}

function failureOf(error: unknown): { code: LakehouseMaintenanceErrorCode; message: string } {
  if (error instanceof JobStopped) {
    return { code: error.code as LakehouseMaintenanceErrorCode, message: error.message };
  }
  if (error instanceof ConfirmationRequiredError) {
    return { code: 'usage_error', message: error.message };
  }
  if (error instanceof LakehouseError) {
    return jobErrorForLakehouseFailure(error);
  }
  return { code: 'internal_error', message: describeFailure(error) };
}

function describeReport(summary: LakehouseMaintenanceSummary): void {
  const { expiredSnapshots, deletedFiles, deletedOrphans, compactedTables } = summary;
  console.error(
    summary.dryRun
      ? `Would expire ${expiredSnapshots} version(s), delete ${deletedFiles} file(s) and ${deletedOrphans} orphan(s), and compact ${compactedTables} table(s).`
      : `Expired ${expiredSnapshots} version(s), deleted ${deletedFiles} file(s) and ${deletedOrphans} orphan(s), compacted ${compactedTables} table(s).`,
  );
  for (const note of summary.notes) {
    console.error(styleText('yellow', note));
  }
}
