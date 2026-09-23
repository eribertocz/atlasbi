import { composeDown, composeLogs } from '../container-runtime/podman.ts';
import { hasEnvFile, loadEnvFile } from '../local-environment.ts';
import { startLocalStack } from './dev.ts';

// Until the platform has its own services (build steps 5–6), the fully containerized stack and
// the infrastructure `pnpm dev` starts are the same set of containers.
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
