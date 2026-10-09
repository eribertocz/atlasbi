import { parseSemanticRefreshSummary } from '@atlasbi/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runSemantic } from '../../src/commands/semantic.ts';

describe('pnpm semantic, before it asks the semantic layer anything', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('answers a wrong call with the usage exit code and, with --json, a summary on stdout alone', async () => {
    for (const args of [
      ['rebuild', '--json'],
      ['refresh', 'now', '--json'],
      ['refresh', '--all', '--json'],
    ]) {
      vi.restoreAllMocks();
      const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await runSemantic(args);

      const lines = stdout.mock.calls.map(([line]) => String(line));
      expect(process.exitCode, args.join(' ')).toBe(64);
      expect(lines).toHaveLength(1);
      expect(parseSemanticRefreshSummary(JSON.parse(lines[0] ?? '') as unknown)).toMatchObject({
        exitCode: 64,
        error: { code: 'usage_error' },
      });
    }
  });
});
