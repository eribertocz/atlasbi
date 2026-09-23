import { existsSync } from 'node:fs';
import path from 'node:path';

import { parseVersion } from '../checks/version.ts';
import { runCommand } from '../system/run-command.ts';

// The single place that decides which compose provider `podman compose` uses. The choice is
// handed only to the child processes this CLI starts — never written to the user's environment,
// the registry or containers.conf, which would change every other Podman project on the machine.

const PROVIDER_VARIABLE = 'PODMAN_COMPOSE_PROVIDER';

export interface ComposeProviderSelection {
  path: string;
  /** `configured`: ATLASBI_COMPOSE_PROVIDER in this repo's .env; `discovered`: found on PATH. */
  source: 'configured' | 'discovered';
}

export interface ComposeCandidate {
  path: string;
  versionOutput: string;
}

export class ComposeProviderNotFoundError extends Error {
  readonly rejected: readonly string[];

  constructor(message: string, rejected: readonly string[] = []) {
    super(message);
    this.name = 'ComposeProviderNotFoundError';
    this.rejected = rejected;
  }
}

// Docker Desktop ships two copies (resources\bin and cli-plugins); its builds also carry a
// `-desktop` version suffix, which catches them wherever they are installed.
export function isDockerDesktopBuild(
  executablePath: string | undefined,
  versionOutput: string,
): boolean {
  return (
    /-desktop\b/i.test(versionOutput) ||
    /[\\/]Docker[\\/]+(Docker[\\/]+resources|cli-plugins)[\\/]/i.test(executablePath ?? '')
  );
}

/** Every `docker-compose` executable on PATH, in PATH order, without duplicates. */
export function listComposeCandidates(
  pathValue: string,
  platform: NodeJS.Platform,
  fileExists: (file: string) => boolean,
): string[] {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const executable = platform === 'win32' ? 'docker-compose.exe' : 'docker-compose';
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const directory of pathValue.split(paths.delimiter)) {
    if (directory.trim() === '') {
      continue;
    }
    const candidate = paths.join(directory, executable);
    const key = platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (!seen.has(key) && fileExists(candidate)) {
      seen.add(key);
      candidates.push(candidate);
    }
  }
  return candidates;
}

/** First standalone docker-compose; Docker Desktop builds and broken binaries are skipped. */
export function chooseComposeProvider(candidates: readonly ComposeCandidate[]): {
  chosen: string | undefined;
  rejected: string[];
} {
  const rejected: string[] = [];
  for (const candidate of candidates) {
    if (isDockerDesktopBuild(candidate.path, candidate.versionOutput)) {
      rejected.push(`${candidate.path} (Docker Desktop build)`);
    } else if (parseVersion(candidate.versionOutput) === undefined) {
      rejected.push(`${candidate.path} (no usable \`version\` output)`);
    } else {
      return { chosen: candidate.path, rejected };
    }
  }
  return { chosen: undefined, rejected };
}

/** Environment for a `podman compose` child process; `process.env` itself is never modified. */
export function composeProcessEnvironment(
  providerPath: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  // Windows variable names are case-insensitive: drop any spelling of the variable before
  // setting ours, so the child never receives two conflicting values.
  const environment = Object.fromEntries(
    Object.entries(baseEnv).filter(([name]) => name.toUpperCase() !== PROVIDER_VARIABLE),
  );
  return { ...environment, [PROVIDER_VARIABLE]: providerPath };
}

let resolution: Promise<ComposeProviderSelection> | undefined;

/** Resolved once per process: the repo's .env override wins over discovery on PATH. */
export function resolveComposeProvider(): Promise<ComposeProviderSelection> {
  resolution ??= findComposeProvider(process.env);
  return resolution;
}

export async function findComposeProvider(
  env: NodeJS.ProcessEnv,
): Promise<ComposeProviderSelection> {
  const configured = env.ATLASBI_COMPOSE_PROVIDER?.trim();
  if (configured) {
    if (!existsSync(configured)) {
      throw new ComposeProviderNotFoundError(
        `ATLASBI_COMPOSE_PROVIDER points to a file that does not exist: ${configured}`,
      );
    }
    return { path: configured, source: 'configured' };
  }

  const candidates = listComposeCandidates(env.PATH ?? '', process.platform, existsSync);
  const withVersions = await Promise.all(
    candidates.map(async (candidate) => {
      const result = await runCommand(candidate, ['version']);
      return { path: candidate, versionOutput: result.exitCode === 0 ? result.stdout.trim() : '' };
    }),
  );
  const { chosen, rejected } = chooseComposeProvider(withVersions);
  if (chosen === undefined) {
    throw new ComposeProviderNotFoundError(
      rejected.length === 0
        ? 'No standalone docker-compose found on PATH.'
        : `No standalone docker-compose found on PATH (skipped: ${rejected.join('; ')}).`,
      rejected,
    );
  }
  return { path: chosen, source: 'discovered' };
}
