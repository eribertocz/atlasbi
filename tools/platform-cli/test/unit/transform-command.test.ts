import { parseTransformSummary } from '@atlasbi/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runTransform } from '../../src/commands/transform.ts';

describe('pnpm transform, before it runs anything', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  const run = async (args: readonly string[]) => {
    vi.restoreAllMocks();
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runTransform(args);
    return {
      out: stdout.mock.calls.map(([line]) => String(line)),
      err: stderr.mock.calls.map(([line]) => String(line)).join('\n'),
      exitCode: process.exitCode,
    };
  };

  it('offers the verbs, and never names the tool behind them', async () => {
    const { out } = await run([]);

    expect(out.join('\n')).toMatch(/run \| deploy \| test \| check/);
    expect(out.join('\n')).not.toMatch(/sqlmesh/i);
  });

  it('answers a wrong call with the usage exit code and, with --json, a summary on stdout alone', async () => {
    for (const args of [
      ['plan', '--json'],
      ['run', 'extra', '--json'],
      ['run', '--verbose', '--json'],
    ]) {
      const { out, exitCode } = await run(args);

      expect(exitCode, args.join(' ')).toBe(64);
      expect(out).toHaveLength(1);
      expect(parseTransformSummary(JSON.parse(out[0] ?? '') as unknown)).toMatchObject({
        status: 'failed',
        exitCode: 64,
        error: { code: 'usage_error' },
      });
    }
  });

  it('warns that `tool` is outside the job contract, before anything else', async () => {
    const { err, exitCode } = await run(['tool']);

    expect(err).toMatch(/OUTSIDE the job contract/);
    expect(err).toMatch(/never in the orchestrator nor in CI/);
    expect(err).not.toMatch(/sqlmesh/i);
    expect(exitCode).toBe(64);
  });
});
