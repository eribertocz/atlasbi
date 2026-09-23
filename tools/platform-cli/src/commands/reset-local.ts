import { createInterface } from 'node:readline/promises';

import { composeDown, ensureEngineRunning } from '../container-runtime/podman.ts';
import { hasEnvFile, loadEnvFile } from '../local-environment.ts';
import { PROJECT_NAME } from '../workspace-paths.ts';

const CONFIRM_FLAG = `--confirm=${PROJECT_NAME}`;

/**
 * Destroys the local stack including its data volumes (docs/19 §2: destructive, always explicit).
 * Confirmation is typed interactively, or given as `--confirm=atlasbi` for scripted use.
 * `.env` is configuration, not data, and is left untouched.
 */
export async function runResetLocal(args: readonly string[]): Promise<void> {
  if (!args.includes(CONFIRM_FLAG) && !(await confirmInteractively())) {
    console.log('Cancelled — nothing was deleted.');
    return;
  }
  if (hasEnvFile()) {
    loadEnvFile();
  }
  await ensureEngineRunning();
  await composeDown({ removeVolumes: true });
  console.log('\nLocal stack and its data removed. Run `pnpm bootstrap` to start from scratch.');
}

async function confirmInteractively(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error(
      `reset:local deletes all local data. Confirm in an interactive terminal, or pass ${CONFIRM_FLAG}.`,
    );
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(
      `This permanently deletes all local data (every volume of the "${PROJECT_NAME}" stack).\n` +
        `Type "${PROJECT_NAME}" to confirm: `,
    );
    return answer.trim() === PROJECT_NAME;
  } finally {
    prompt.close();
  }
}
