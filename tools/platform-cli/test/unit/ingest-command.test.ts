import { parseIngestSummary } from '@atlasbi/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runIngest } from '../../src/commands/ingest.ts';

describe('pnpm ingest, before it runs anything', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  const run = async (args: readonly string[]) => {
    vi.restoreAllMocks();
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runIngest(args);
    return { lines: stdout.mock.calls.map(([line]) => String(line)), exitCode: process.exitCode };
  };

  it('answers a wrong call with the usage exit code and, with --json, a summary on stdout alone', async () => {
    for (const args of [
      ['--json'],
      ['nope', '--json'],
      ['github', 'extra', '--json'],
      ['github', '--verbose', '--json'],
    ]) {
      const { lines, exitCode } = await run(args);

      expect(exitCode, args.join(' ')).toBe(64);
      expect(lines).toHaveLength(1);
      expect(parseIngestSummary(JSON.parse(lines[0] ?? '') as unknown)).toMatchObject({
        status: 'failed',
        exitCode: 64,
        retryable: false,
        error: { code: 'usage_error' },
      });
    }
  });

  it('prints nothing on stdout without --json', async () => {
    const { lines, exitCode } = await run(['nope']);

    expect(exitCode).toBe(64);
    expect(lines).toEqual([]);
  });
});
