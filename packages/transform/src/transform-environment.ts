import { spawn } from 'node:child_process';

import { TRANSFORM_PACKAGE_DIRECTORY } from './run-sqlmesh.ts';

export interface TransformEnvironment {
  python: string;
  sqlmesh: string;
  duckdb: string;
}

export type TransformEnvironmentState = 'synced' | 'out-of-sync' | 'missing-uv';

/**
 * Bootstrap only — the one moment the transform package downloads anything: uv creates
 * packages/transform/.venv exactly as uv.lock says (`--frozen`: the lock is never rewritten).
 */
export async function syncTransformEnvironment(): Promise<TransformEnvironment> {
  const sync = await runUv(['sync', '--frozen']);
  if (sync.exitCode !== 0) {
    throw new Error(`\`uv sync\` failed: ${lastLine(sync.output)}`);
  }
  return readTransformEnvironment();
}

/** Offline and read-only (preflight): is .venv exactly what uv.lock says? */
export async function checkTransformEnvironment(): Promise<TransformEnvironmentState> {
  try {
    const check = await runUv(['sync', '--frozen', '--offline', '--check']);
    return check.exitCode === 0 ? 'synced' : 'out-of-sync';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'missing-uv';
    }
    throw error;
  }
}

export async function readTransformEnvironment(): Promise<TransformEnvironment> {
  const probe = await runUv([
    'run',
    '--frozen',
    '--offline',
    'python',
    '-c',
    'import sys, sqlmesh, duckdb; print(sys.version.split()[0], sqlmesh.__version__, duckdb.__version__)',
  ]);
  const [python = '', sqlmesh = '', duckdb = ''] = lastLine(probe.output).split(' ');
  if (probe.exitCode !== 0 || duckdb === '') {
    throw new Error(`The transform environment is not usable: ${lastLine(probe.output)}`);
  }
  return { python, sqlmesh, duckdb };
}

function runUv(args: readonly string[]): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('uv', args, {
      cwd: TRANSFORM_PACKAGE_DIRECTORY,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.once('error', reject);
    child.once('close', (code) => resolve({ exitCode: code ?? 1, output }));
  });
}

function lastLine(output: string): string {
  return (
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? ''
  );
}
