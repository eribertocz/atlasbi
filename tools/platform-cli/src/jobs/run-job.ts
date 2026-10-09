import { styleText } from 'node:util';

/** What every job summary has that the command line needs (docs/07 §7.1). */
export interface JobOutcome {
  exitCode: number;
  retryable: boolean;
  error?: { code: string; message: string };
}

/** A job stopped before its runner could answer — a usage or configuration error of its caller. */
export class JobStopped<Code extends string = string> extends Error {
  readonly code: Code;

  constructor(code: Code, message: string) {
    super(message);
    this.name = 'JobStopped';
    this.code = code;
  }
}

/**
 * The positional arguments and the one flag every job takes; anything else is a usage error. Never
 * guesses: an unknown flag is a mistake to say, not to ignore.
 */
export function parseJobArguments(
  args: readonly string[],
  usage: string,
): { positional: string[]; json: boolean } {
  const unknown = args.filter((arg) => arg.startsWith('--') && arg !== '--json');
  if (unknown.length > 0) {
    throw new JobStopped('usage_error', usage);
  }
  return { positional: args.filter((arg) => !arg.startsWith('--')), json: args.includes('--json') };
}

/**
 * How every job ends at the command line: with `--json`, the summary alone on stdout; always, one
 * line for a person on stderr; and the summary's exit code as the process's.
 */
export function reportJob(label: string, summary: JobOutcome, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(summary));
  }
  if (summary.error === undefined) {
    console.error(styleText('green', `${label} succeeded.`));
  } else {
    const retry = summary.retryable ? ' It can be run again as it is.' : '';
    console.error(
      styleText(
        'red',
        `${label} failed (${summary.error.code}, exit ${summary.exitCode}): ${summary.error.message}${retry}`,
      ),
    );
  }
  process.exitCode = summary.exitCode;
}

/** A job's Python environment must be exactly what its lock says before it runs (`pnpm preflight`). */
export function assertEnvironmentReady(
  state: 'synced' | 'out-of-sync' | 'missing-uv',
  label: string,
): void {
  if (state === 'missing-uv') {
    throw new JobStopped(
      'configuration_error',
      '`uv` was not found on PATH — see `pnpm preflight`.',
    );
  }
  if (state === 'out-of-sync') {
    throw new JobStopped(
      'configuration_error',
      `The ${label} environment is not prepared or out of date — run \`pnpm bootstrap\`.`,
    );
  }
}
