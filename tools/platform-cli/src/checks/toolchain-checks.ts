import { readFileSync } from 'node:fs';

import { CommandNotFoundError, runCommand } from '../system/run-command.ts';
import { WORKSPACE_FILES } from '../workspace-paths.ts';
import type { CheckResult } from './check-result.ts';
import { compareVersions, formatVersion, parseVersion, type Version } from './version.ts';

const MINIMUM_UV_VERSION: Version = [0, 11, 0];

export function checkNode(currentVersion: string = process.versions.node): CheckResult {
  return evaluateNodeVersion(currentVersion, readFileSync(WORKSPACE_FILES.nodeVersionFile, 'utf8'));
}

/** Same major as `.node-version` (the LTS line) and at least that patch level. */
export function evaluateNodeVersion(currentVersion: string, pinnedVersion: string): CheckResult {
  const current = parseVersion(currentVersion);
  const pinned = parseVersion(pinnedVersion);
  if (!current || !pinned) {
    return { name: 'Node.js', status: 'fail', detail: `cannot parse version "${currentVersion}"` };
  }
  const requirement = `${pinned[0]}.x ≥ ${formatVersion(pinned)}`;
  if (current[0] !== pinned[0] || compareVersions(current, pinned) < 0) {
    return {
      name: 'Node.js',
      status: 'fail',
      detail: `${formatVersion(current)} (requires ${requirement})`,
      remedy: `Install Node.js ${formatVersion(pinned)} (see .node-version).`,
    };
  }
  return {
    name: 'Node.js',
    status: 'pass',
    detail: `${formatVersion(current)} (requires ${requirement})`,
  };
}

export function checkPackageManager(
  userAgent: string | undefined = process.env.npm_config_user_agent,
): CheckResult {
  const packageJson = JSON.parse(readFileSync(WORKSPACE_FILES.rootPackageJson, 'utf8')) as {
    packageManager: string;
  };
  return evaluatePackageManager(userAgent, packageJson.packageManager);
}

export function evaluatePackageManager(
  userAgent: string | undefined,
  packageManagerField: string,
): CheckResult {
  const expected = packageManagerField.replace(/^pnpm@/, '');
  const running = /pnpm\/(\d+\.\d+\.\d+)/.exec(userAgent ?? '')?.[1];
  if (running === undefined) {
    return {
      name: 'pnpm',
      status: 'warn',
      detail: `not launched through pnpm (expected ${expected})`,
      remedy: 'Run platform commands as `pnpm <command>`.',
    };
  }
  if (running !== expected) {
    return {
      name: 'pnpm',
      status: 'fail',
      detail: `${running} (expected ${expected}, pinned in package.json)`,
      remedy: 'Run `corepack enable` so the pinned pnpm version is used automatically.',
    };
  }
  return { name: 'pnpm', status: 'pass', detail: running };
}

export async function checkUv(): Promise<CheckResult> {
  const remedy = 'Install uv: https://docs.astral.sh/uv/getting-started/installation/';
  try {
    const result = await runCommand('uv', ['--version']);
    const version = parseVersion(result.stdout);
    if (!version) {
      return { name: 'uv', status: 'fail', detail: 'unrecognized `uv --version` output', remedy };
    }
    if (compareVersions(version, MINIMUM_UV_VERSION) < 0) {
      return {
        name: 'uv',
        status: 'fail',
        detail: `${formatVersion(version)} (requires ≥ ${formatVersion(MINIMUM_UV_VERSION)})`,
        remedy,
      };
    }
    return { name: 'uv', status: 'pass', detail: formatVersion(version) };
  } catch (error) {
    if (error instanceof CommandNotFoundError) {
      return { name: 'uv', status: 'fail', detail: 'not installed', remedy };
    }
    throw error;
  }
}
