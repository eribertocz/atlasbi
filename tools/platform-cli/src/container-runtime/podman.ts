import { runCommand, type CommandResult } from '../system/run-command.ts';
import { WORKSPACE_FILES, WORKSPACE_ROOT } from '../workspace-paths.ts';
import { composeProcessEnvironment, resolveComposeProvider } from './compose-provider.ts';

// The only module that talks to the container engine: swapping Podman for another OCI runtime
// means rewriting this file, nothing else.

export interface PodmanMachine {
  name: string;
  running: boolean;
}

export interface ComposeProviderInfo {
  /** Path of the external provider `podman compose` delegates to, when Podman reports it. */
  providerPath: string | undefined;
  versionOutput: string;
}

/* eslint-disable @typescript-eslint/naming-convention -- Podman/compose JSON wire format. */
interface MachineListEntry {
  Name?: string;
  Running?: boolean;
}

interface ComposePsEntry {
  Service?: string;
  State?: string;
}
/* eslint-enable @typescript-eslint/naming-convention */

export async function podmanVersionOutput(): Promise<string> {
  const result = await runCommand('podman', ['--version']);
  return result.stdout.trim();
}

// Only the exit code matters: a `--format` template ties this check to Podman's internal field
// names, which already broke once (`.Host.Os` does not exist in Podman 5.8).
export async function isEngineReachable(): Promise<boolean> {
  const result = await runCommand('podman', ['info', '--format', 'json']);
  return result.exitCode === 0;
}

/** Podman runs containers inside a VM on Windows and macOS; Linux talks to the host directly. */
export function needsMachine(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' || platform === 'darwin';
}

export async function listMachines(): Promise<PodmanMachine[]> {
  const result = await runCommand('podman', ['machine', 'list', '--format', 'json']);
  return result.exitCode === 0 ? parseMachineList(result.stdout) : [];
}

export function parseMachineList(output: string): PodmanMachine[] {
  const machines = JSON.parse(output || '[]') as MachineListEntry[];
  return machines.map((machine) => ({
    name: machine.Name ?? '',
    running: machine.Running === true,
  }));
}

export async function startMachine(name: string): Promise<void> {
  expectSuccess(
    await runCommand('podman', ['machine', 'start', name], { stdio: 'inherit' }),
    `podman machine start ${name}`,
  );
}

/** Starts the Podman machine if it exists but is stopped; never creates or deletes one. */
export async function ensureEngineRunning(): Promise<void> {
  if (await isEngineReachable()) {
    return;
  }
  const [machine] = needsMachine() ? await listMachines() : [];
  if (!machine) {
    throw new Error('The Podman engine is not reachable. Run `pnpm preflight` for details.');
  }
  console.log(`Starting Podman machine "${machine.name}"...`);
  await startMachine(machine.name);
}

/** What `podman compose` really runs, under exactly the environment `compose()` uses. */
export async function composeProviderInfo(): Promise<ComposeProviderInfo> {
  // Warning logs stay on here: they are where Podman names the provider it delegates to.
  const result = await runCommand('podman', ['compose', 'version'], {
    env: await composeEnvironment({ quiet: false }),
  });
  return {
    providerPath: parseComposeProviderPath(result.stderr + result.stdout),
    versionOutput: result.stdout.trim(),
  };
}

// Podman prints the path with escaped backslashes (`C:\\Program Files\\...`); unescape it so
// checks and messages see the real path.
export function parseComposeProviderPath(output: string): string | undefined {
  return /external compose provider "([^"]+)"/.exec(output)?.[1]?.replaceAll('\\\\', '\\');
}

export async function composeUp(): Promise<void> {
  expectSuccess(await compose(['up', '--detach'], 'inherit'), 'podman compose up');
}

export async function composeDown(options: { removeVolumes: boolean }): Promise<void> {
  const args = options.removeVolumes ? ['down', '--volumes'] : ['down'];
  expectSuccess(await compose(args, 'inherit'), 'podman compose down');
}

export async function composeLogs(options: { follow: boolean }): Promise<void> {
  const args = options.follow ? ['logs', '--follow'] : ['logs'];
  expectSuccess(await compose(args, 'inherit'), 'podman compose logs');
}

/** Services of this project that are currently running; empty when the engine is down. */
export async function runningServices(): Promise<Set<string>> {
  const result = await compose(['ps', '--format', 'json'], 'pipe');
  return result.exitCode === 0 ? parseRunningServices(result.stdout) : new Set();
}

// docker-compose prints either one JSON array or one JSON object per line, depending on version.
export function parseRunningServices(output: string): Set<string> {
  const trimmed = output.trim();
  if (trimmed === '') {
    return new Set();
  }
  const entries = (
    trimmed.startsWith('[')
      ? JSON.parse(trimmed)
      : trimmed.split(/\r?\n/).map((line) => JSON.parse(line) as unknown)
  ) as ComposePsEntry[];
  return new Set(
    entries
      .filter((entry) => entry.State === 'running' && entry.Service !== undefined)
      .map((entry) => entry.Service as string),
  );
}

async function compose(args: readonly string[], stdio: 'pipe' | 'inherit'): Promise<CommandResult> {
  return runCommand('podman', ['compose', '--file', WORKSPACE_FILES.composeFile, ...args], {
    cwd: WORKSPACE_ROOT,
    env: await composeEnvironment({ quiet: true }),
    stdio,
  });
}

async function composeEnvironment(options: { quiet: boolean }): Promise<NodeJS.ProcessEnv> {
  const environment = composeProcessEnvironment((await resolveComposeProvider()).path);
  return options.quiet ? { ...environment, PODMAN_COMPOSE_WARNING_LOGS: 'false' } : environment;
}

function expectSuccess(result: CommandResult, description: string): void {
  if (result.exitCode !== 0) {
    const output = result.stderr.trim();
    throw new Error(
      `\`${description}\` failed with exit code ${result.exitCode}${output ? `:\n${output}` : ''}`,
    );
  }
}
