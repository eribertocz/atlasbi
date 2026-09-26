import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadLakehouseConfig } from '@atlasbi/config';

import { SQLMESH_PROJECT_DIRECTORY, TRANSFORM_PACKAGE_DIRECTORY } from '../../src/index.ts';

const WORKSPACE_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export function workspaceEnvironment(): void {
  const envFile = path.join(WORKSPACE_ROOT, '.env');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

/** The DuckDB extensions `pnpm bootstrap` installed — tests never download anything either. */
export function extensionDirectory(): string {
  workspaceEnvironment();
  return loadLakehouseConfig(process.env, { baseDirectory: WORKSPACE_ROOT }).extensionDirectory;
}

/** A disposable copy of the SQLMesh project, for tests that add or change models. */
export async function copyProject(): Promise<{ directory: string; dispose(): Promise<void> }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'atlasbi-sqlmesh-project-'));
  await cp(SQLMESH_PROJECT_DIRECTORY, directory, {
    recursive: true,
    filter: (source) => !source.includes('.cache') && !source.includes('__pycache__'),
  });
  return { directory, dispose: () => rm(directory, { recursive: true, force: true }) };
}

/** Runs a command in the transform package's uv environment, with exactly the given environment. */
export function runInTransformEnvironment(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('uv', ['run', '--frozen', '--offline', ...args], {
      cwd: TRANSFORM_PACKAGE_DIRECTORY,
      env: { ...env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.once('error', reject);
    child.once('close', (code) => resolve({ exitCode: code ?? 1, output }));
  });
}

/** process.env without any ATLASBI_* variable — what a direct `uv run sqlmesh` would see. */
export function environmentWithoutPlatformVariables(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('ATLASBI_')),
  );
}
