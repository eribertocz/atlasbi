import { composeDown, composeLogs } from '../container-runtime/podman.ts';
import { hasEnvFile, loadEnvFile } from '../local-environment.ts';
import { startLocalStack } from './dev.ts';

// Until the platform's own services have container images (build step 6), the fully containerized
// stack is the infrastructure `pnpm dev` starts, without the API gateway it runs as a process.
export async function runStackUp(): Promise<void> {
  await startLocalStack();
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
