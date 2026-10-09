import { MIN_ORPHAN_GRACE_HOURS, parseLakehouseMaintenanceSummary } from '@atlasbi/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { notesFor, runLakehouse } from '../../src/commands/lakehouse.ts';
import {
  CONFIRM_FLAG,
  ConfirmationRequiredError,
  confirmByTyping,
} from '../../src/system/confirmation.ts';

const POLICY = { snapshotRetentionDays: 7, cleanupGraceMinutes: 60, orphanGraceHours: 24 };

describe('pnpm lakehouse maintain, before it touches the lakehouse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
  });

  const run = async (args: readonly string[]) => {
    vi.restoreAllMocks();
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runLakehouse(args);
    const lines = stdout.mock.calls.map(([line]) => String(line));
    return {
      lines,
      exitCode: process.exitCode,
      summary: () => parseLakehouseMaintenanceSummary(JSON.parse(lines[0] ?? '') as unknown),
    };
  };

  it('answers a wrong call with the usage exit code, a summary alone on stdout', async () => {
    for (const args of [
      ['clean', '--json'],
      ['maintain', 'now', '--json'],
      ['maintain', '--force', '--json'],
    ]) {
      const { lines, exitCode, summary } = await run(args);

      expect(exitCode, args.join(' ')).toBe(64);
      expect(lines).toHaveLength(1);
      expect(summary()).toMatchObject({ exitCode: 64, error: { code: 'usage_error' } });
    }
  });

  it('refuses an orphan grace under the floor from the command line', async () => {
    for (const hours of [String(MIN_ORPHAN_GRACE_HOURS - 1), '-3', '0.5', 'soon']) {
      const { exitCode, summary } = await run([
        'maintain',
        `--orphan-grace-hours=${hours}`,
        '--json',
      ]);

      expect(exitCode, hours).toBe(64);
      expect(summary().error?.message, hours).toMatch(/at least 1/);
    }
  });

  it('refuses an orphan grace under the floor from the environment, before touching anything', async () => {
    vi.stubEnv('ATLASBI_LAKEHOUSE_ORPHAN_GRACE_HOURS', '0');

    const { exitCode, summary } = await run(['maintain', '--dry-run', '--json']);

    expect(exitCode).toBe(78);
    expect(summary().error?.code).toBe('configuration_error');
    // Without a .env (CI), the missing file stops it first — still a configuration error.
    expect(summary().error?.message).toMatch(
      /ATLASBI_LAKEHOUSE_ORPHAN_GRACE_HOURS|\.env does not exist/,
    );
  });

  it('says, on a dry run, that what today frees is deleted only by the next run', () => {
    const notes = notesFor(POLICY, true).join(' ');

    expect(notes).toMatch(/nothing was changed/);
    expect(notes).toMatch(/deleted by the next run, once the 60-minute cleanup grace has passed/);
    expect(notes).toMatch(/a 0 here does not mean there is nothing to delete/);
  });
});

describe('the explicit yes of destructive commands', () => {
  it('takes the flag, and never assumes a yes where nobody can type it', async () => {
    await expect(confirmByTyping([CONFIRM_FLAG], 'Danger.')).resolves.toBe(true);
    // Under the test runner stdin is no terminal: without the flag, the command refuses.
    await expect(confirmByTyping([], 'Danger.')).rejects.toThrow(ConfirmationRequiredError);
  });
});
