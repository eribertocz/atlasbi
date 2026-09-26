import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TRANSFORM_PACKAGE_DIRECTORY } from '../../src/index.ts';
import { extensionDirectory, runInTransformEnvironment } from '../support/transform-environment.ts';

interface ProbeResult {
  upstreamFixPresent: boolean;
  unpatched: string;
  patched: string;
  cascadableKinds: string[];
}

const REMOVE_THE_PATCH =
  'SQLMesh now drops DuckLake tables without CASCADE on its own (upstream PR SQLMesh/sqlmesh#6034): ' +
  'delete packages/transform/project/ducklake_compat.py, its call in config.py, this test and the probe.';

// ALERT TEST for a temporary, experimental patch (CLAUDE.md rule 6). It passes while the patch is
// needed and fails, with instructions, the day the pinned SQLMesh ships the upstream fix.
describe('DuckLake compatibility patch (temporary)', () => {
  it('is still needed, and still works, on the pinned SQLMesh', async () => {
    const run = await runInTransformEnvironment(
      [
        'python',
        path.join(TRANSFORM_PACKAGE_DIRECTORY, 'checks', 'ducklake_drop_probe.py'),
        extensionDirectory().replaceAll('\\', '/'),
      ],
      process.env,
    );
    expect(run.exitCode, run.output).toBe(0);
    const result = JSON.parse(run.output.trim().split('\n').at(-1) ?? '{}') as ProbeResult;

    expect(result.upstreamFixPresent, REMOVE_THE_PATCH).toBe(false);
    expect(result.unpatched, REMOVE_THE_PATCH).toContain('Cascade Drop not supported in DuckLake');
    expect(result.patched).toBe('dropped');
    expect(result.cascadableKinds).toEqual(['SCHEMA']);
  });
});
