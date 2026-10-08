import { describe, expect, it } from 'vitest';

import { evaluateNodeVersion, evaluatePackageManager } from '../../src/checks/toolchain-checks.ts';
import { compareVersions, parseVersion } from '../../src/checks/version.ts';
import { readLocalInfraPorts } from '../../src/local-environment.ts';

describe('versions', () => {
  it('parses the first x.y.z in tool output', () => {
    expect(parseVersion('uv 0.11.21 (5aa65dd7a 2026-06-11)')).toEqual([0, 11, 21]);
    expect(parseVersion('Docker Compose version v5.5.1')).toEqual([5, 5, 1]);
    expect(parseVersion('no version here')).toBeUndefined();
  });

  it('compares numerically, not lexically', () => {
    expect(compareVersions([0, 11, 0], [0, 9, 9])).toBeGreaterThan(0);
    expect(compareVersions([24, 12, 0], [24, 12, 0])).toBe(0);
  });
});

describe('evaluateNodeVersion', () => {
  it('accepts the pinned LTS line at or above the pinned patch', () => {
    expect(evaluateNodeVersion('24.12.0', '24.12.0\n').status).toBe('pass');
    expect(evaluateNodeVersion('24.13.1', '24.12.0').status).toBe('pass');
  });

  it('rejects an older patch or another major', () => {
    expect(evaluateNodeVersion('24.11.0', '24.12.0').status).toBe('fail');
    expect(evaluateNodeVersion('26.1.0', '24.12.0').status).toBe('fail');
  });
});

describe('evaluatePackageManager', () => {
  it('passes when pnpm matches the packageManager pin', () => {
    const result = evaluatePackageManager(
      'pnpm/11.27.1 npm/? node/v24.12.0 win32 x64',
      'pnpm@11.27.1',
    );
    expect(result.status).toBe('pass');
  });

  it('fails on a different pnpm version and warns when not launched through pnpm', () => {
    expect(evaluatePackageManager('pnpm/12.5.1 node/v24.12.0', 'pnpm@11.27.1').status).toBe('fail');
    expect(evaluatePackageManager(undefined, 'pnpm@11.27.1').status).toBe('warn');
  });
});

describe('readLocalInfraPorts', () => {
  it('uses defaults for unset or empty variables', () => {
    expect(readLocalInfraPorts({ ATLASBI_POSTGRES_PORT: '' })).toEqual({
      postgres: 55432,
      otelGrpc: 4317,
      otelHttp: 4318,
      otelHealth: 13133,
      objectStorage: 53900,
      objectStorageAdmin: 53903,
      cube: 4000,
      cubeSql: 15432,
      gateway: 4100,
      web: 3000,
    });
  });

  it('rejects a value that is not a port', () => {
    expect(() => readLocalInfraPorts({ ATLASBI_POSTGRES_PORT: '99999' })).toThrow();
  });
});
