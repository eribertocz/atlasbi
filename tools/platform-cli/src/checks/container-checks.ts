import path from 'node:path';

import {
  ComposeProviderNotFoundError,
  isDockerDesktopBuild,
  resolveComposeProvider,
  type ComposeProviderSelection,
} from '../container-runtime/compose-provider.ts';
import {
  composeProviderInfo,
  isEngineReachable,
  listMachines,
  needsMachine,
  podmanVersionOutput,
  type ComposeProviderInfo,
} from '../container-runtime/podman.ts';
import { CommandNotFoundError } from '../system/run-command.ts';
import type { CheckResult } from './check-result.ts';
import { compareVersions, formatVersion, parseVersion, type Version } from './version.ts';

const MINIMUM_PODMAN_VERSION: Version = [5, 0, 0];
const MINIMUM_COMPOSE_VERSION: Version = [2, 20, 0];
// Podman Desktop alone is only the UI: the engine is a separate install (real case, Step 0).
const INSTALL_PODMAN =
  'Install the Podman engine — Podman Desktop → Dashboard → Install, or `winget install -e --id RedHat.Podman` — then `podman machine init`. Open a new terminal afterwards so PATH is refreshed.';
const INSTALL_COMPOSE =
  'Install the standalone docker-compose — `winget install -e --id Docker.DockerCompose`, or Podman Desktop → Settings → Resources → Compose. If it is not on PATH, set ATLASBI_COMPOSE_PROVIDER to its full path in this repo’s .env (never as a global variable).';

/** Podman itself, then whether its engine is reachable, then the compose provider it uses. */
export async function checkContainerRuntime(): Promise<CheckResult[]> {
  let versionOutput: string;
  try {
    versionOutput = await podmanVersionOutput();
  } catch (error) {
    if (error instanceof CommandNotFoundError) {
      return [
        { name: 'Podman', status: 'fail', detail: 'not installed', remedy: INSTALL_PODMAN },
        { name: 'Compose provider', status: 'fail', detail: 'requires Podman' },
      ];
    }
    throw error;
  }
  const engine = await checkEngine();
  // `podman compose version` needs a running engine; failing here would stop `pnpm dev` from
  // ever starting the machine, so with the engine down only the selection is checked now and
  // the provider is verified again right after the machine starts.
  const composeProvider =
    engine.status === 'pass' ? await checkComposeProvider() : await checkComposeSelection();
  return [evaluatePodmanVersion(versionOutput), engine, composeProvider];
}

/** Selection, what Podman actually runs with it, and that Podman honoured the selection. */
export async function checkComposeProvider(): Promise<CheckResult> {
  const selection = await selectionOrFailure();
  if ('status' in selection) {
    return selection;
  }
  const info = await composeProviderInfo();
  const result = evaluateComposeProvider(info);
  if (result.status !== 'pass') {
    return result;
  }
  if (info.providerPath !== undefined && !isSamePath(info.providerPath, selection.path)) {
    return {
      name: 'Compose provider',
      status: 'fail',
      detail: `Podman ran ${info.providerPath} instead of the selected ${selection.path}`,
      remedy: INSTALL_COMPOSE,
    };
  }
  return { ...result, detail: `${result.detail} — ${describeSource(selection)}` };
}

async function checkComposeSelection(): Promise<CheckResult> {
  const selection = await selectionOrFailure();
  if ('status' in selection) {
    return selection;
  }
  return {
    name: 'Compose provider',
    status: 'warn',
    detail: `${selection.path} (${describeSource(selection)}) — verified once the Podman engine is running`,
  };
}

async function selectionOrFailure(): Promise<ComposeProviderSelection | CheckResult> {
  try {
    return await resolveComposeProvider();
  } catch (error) {
    if (error instanceof ComposeProviderNotFoundError) {
      return {
        name: 'Compose provider',
        status: 'fail',
        detail: error.message,
        remedy: INSTALL_COMPOSE,
      };
    }
    throw error;
  }
}

function describeSource(selection: ComposeProviderSelection): string {
  return selection.source === 'configured'
    ? 'set by ATLASBI_COMPOSE_PROVIDER in .env'
    : 'selected for this repo only';
}

function isSamePath(left: string, right: string): boolean {
  const normalize = (value: string) => path.resolve(value).replaceAll('\\', '/').toLowerCase();
  return process.platform === 'win32'
    ? normalize(left) === normalize(right)
    : path.resolve(left) === path.resolve(right);
}

export function evaluatePodmanVersion(versionOutput: string): CheckResult {
  const version = parseVersion(versionOutput);
  if (!version || compareVersions(version, MINIMUM_PODMAN_VERSION) < 0) {
    return {
      name: 'Podman',
      status: 'fail',
      detail: `${versionOutput || 'unknown version'} (requires ≥ ${formatVersion(MINIMUM_PODMAN_VERSION)})`,
      remedy: INSTALL_PODMAN,
    };
  }
  return { name: 'Podman', status: 'pass', detail: formatVersion(version) };
}

async function checkEngine(): Promise<CheckResult> {
  if (await isEngineReachable()) {
    return { name: 'Podman engine', status: 'pass', detail: 'reachable' };
  }
  if (!needsMachine()) {
    return {
      name: 'Podman engine',
      status: 'fail',
      detail: 'not reachable',
      remedy: 'Check `podman info` for the underlying error.',
    };
  }
  const [machine] = await listMachines();
  if (!machine) {
    return {
      name: 'Podman engine',
      status: 'fail',
      detail: 'no Podman machine exists',
      remedy: 'Run `podman machine init` once (Podman Desktop onboarding does it for you).',
    };
  }
  return {
    name: 'Podman engine',
    status: 'warn',
    detail: `machine "${machine.name}" is stopped — \`pnpm dev\` starts it`,
  };
}

// This project pins the standalone docker-compose binary as provider (docs/11 §4.2) — never the
// copy bundled with Docker Desktop, whose lifecycle belongs to a product the project does not use.
export function evaluateComposeProvider(info: ComposeProviderInfo): CheckResult {
  const version = parseVersion(info.versionOutput);
  if (!version) {
    return {
      name: 'Compose provider',
      status: 'fail',
      detail: '`podman compose` found no working provider',
      remedy: INSTALL_COMPOSE,
    };
  }
  if (isDockerDesktopBuild(info.providerPath, info.versionOutput)) {
    return {
      name: 'Compose provider',
      status: 'fail',
      detail: `using Docker Desktop's bundled docker-compose (${info.providerPath ?? info.versionOutput})`,
      remedy: INSTALL_COMPOSE,
    };
  }
  if (info.providerPath === undefined) {
    return {
      name: 'Compose provider',
      status: 'warn',
      detail: `${formatVersion(version)} (Podman did not report which provider it used)`,
    };
  }
  if (!/^docker-compose(\.exe)?$/i.test(path.basename(info.providerPath))) {
    return {
      name: 'Compose provider',
      status: 'fail',
      detail: `${info.providerPath} — this project pins docker-compose (docs/11 §4.2)`,
      remedy: INSTALL_COMPOSE,
    };
  }
  if (compareVersions(version, MINIMUM_COMPOSE_VERSION) < 0) {
    return {
      name: 'Compose provider',
      status: 'fail',
      detail: `docker-compose ${formatVersion(version)} (requires ≥ ${formatVersion(MINIMUM_COMPOSE_VERSION)})`,
      remedy: INSTALL_COMPOSE,
    };
  }
  return {
    name: 'Compose provider',
    status: 'pass',
    detail: `docker-compose ${formatVersion(version)} (${info.providerPath})`,
  };
}
