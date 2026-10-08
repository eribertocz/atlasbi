import { composeDown, composeLogs } from '../container-runtime/podman.ts';
import { hasEnvFile, loadEnvFile } from '../local-environment.ts';
import { startLocalStack } from './dev.ts';

/**
 * Everything in containers (docs/19 §2): the infrastructure and the platform's own images, built
 * from this checkout — the way an installation runs, without hot reload. It returns once the web
 * origin answers; the stack keeps running (`pnpm stack:down` stops it).
 */
export async function runStackUp(): Promise<void> {
  await startLocalStack('dev', { platform: 'containers' });
}

export async function runStackDown(): Promise<void> {
  loadEnvFileIfPresent();
  await composeDown({ removeVolumes: false });
}

export async function runStackLogs(): Promise<void> {
  loadEnvFileIfPresent();
  await composeLogs({ follow: true });
}

function loadEnvFileIfPresent(): void {
  if (hasEnvFile()) {
    loadEnvFile();
  }
}
