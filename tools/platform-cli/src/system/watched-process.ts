import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { stripVTControlCharacters, styleText } from 'node:util';

import { runCommand } from './run-command.ts';

/** What `node --watch` prints when the script fails; it then waits for a change instead of exiting. */
const WATCH_FAILURE = /^Failed running '/m;
/**
 * The watcher prints that on stdout once the script has exited; the script's error comes on
 * stderr, a separate pipe that may be read a moment later. Waiting this long gets both.
 */
const FAILURE_SETTLE_MS = 250;
const KEPT_OUTPUT_CHARACTERS = 20_000;
const STOP_GRACE_MS = 5_000;

export interface WatchedProcess {
  /** Resolves with the exit code once the watcher is gone. */
  readonly exited: Promise<number | null>;
  /** True once the watched script has failed and the watcher waits for a change. */
  failedToStart(): boolean;
  /** The error the script failed with, from its output: the lines that say why, not the stack. */
  failureReason(): string;
  /** From now on its output goes to the terminal as it comes, each line with this label. */
  forwardOutput(label: string): void;
  /** Stops the watcher and the script it runs. */
  stop(): Promise<void>;
}

/**
 * A platform service run as `node --watch <script>` (decision G7): it restarts on every change of
 * the script or anything it imports. Its output is kept — not shown — until `forwardOutput`, so the
 * readiness summary stays readable.
 */
export function startWatchedProcess(script: string, options: { cwd: string }): WatchedProcess {
  const child = spawn(process.execPath, ['--watch', script], {
    cwd: options.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // Its own process group on POSIX, so `stop` reaches the script `node --watch` runs. On
    // Windows the console delivers Ctrl+C to every process attached to it already.
    detached: process.platform !== 'win32',
  });
  let kept = '';
  let label: string | undefined;
  let failedAt: number | undefined;
  const exited = once(child, 'exit').then(([code]) => code as number | null);

  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8').on('data', (chunk: string) => {
      if (label === undefined) {
        // Colors (FORCE_COLOR) would hide the lines this looks for.
        kept = (kept + stripVTControlCharacters(chunk)).slice(-KEPT_OUTPUT_CHARACTERS);
        if (failedAt === undefined && WATCH_FAILURE.test(kept)) {
          failedAt = Date.now();
        }
        return;
      }
      for (const line of chunk.replace(/\n$/, '').split('\n')) {
        console.log(`${styleText('gray', label)} ${line}`);
      }
    });
  }

  return {
    exited,
    failedToStart: () => failedAt !== undefined && Date.now() - failedAt >= FAILURE_SETTLE_MS,
    failureReason: () => errorLines(kept),
    forwardOutput(newLabel) {
      label = newLabel;
      const pending = kept.replace(/\n$/, '');
      kept = '';
      for (const line of pending === '' ? [] : pending.split('\n')) {
        console.log(`${styleText('gray', newLabel)} ${line}`);
      }
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      await terminate(child);
      const stopped = await Promise.race([exited.then(() => true), delay(STOP_GRACE_MS, false)]);
      if (!stopped) {
        await terminate(child, { force: true });
        await exited;
      }
    },
  };
}

async function terminate(child: ChildProcess, options: { force?: boolean } = {}): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  if (process.platform === 'win32') {
    // A signal from here would end the watcher only, leaving the script holding its port; and a
    // console process cannot be asked to close, only ended (/F). Ctrl+C reaches it on its own.
    await runCommand('taskkill', ['/pid', String(pid), '/T', '/F']);
    return;
  }
  try {
    process.kill(-pid, options.force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    // Already gone.
  }
}

/** `Error: …` (or `ConfigurationError: …`) and what follows it, without the stack frames. */
export function errorLines(output: string): string {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((line) => /^(?:[A-Z]\w*)?(?:Error|Exception)\b/.test(line));
  if (start === -1) {
    return lines.filter((line) => line.trim() !== '').at(-1) ?? 'it stopped without a message';
  }
  const reason: string[] = [];
  for (const line of lines.slice(start)) {
    if (/^\s+at /.test(line) || /^Node\.js v/.test(line) || /^Failed running '/.test(line)) {
      break;
    }
    if (line.trim() !== '') {
      reason.push(line.trim());
    }
  }
  return reason.join(' ');
}
