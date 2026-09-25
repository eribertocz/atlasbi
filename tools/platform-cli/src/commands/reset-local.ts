import { rm } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';

import { composeDown, ensureEngineRunning } from '../container-runtime/podman.ts';
import { hasEnvFile, loadEnvFile } from '../local-environment.ts';
import { PROJECT_NAME, WORKSPACE_FILES } from '../workspace-paths.ts';

const CONFIRM_FLAG = `--confirm=${PROJECT_NAME}`;

/**
 * Destroys the local stack including its data volumes and the lakehouse folder (docs/19 §2:
 * destructive, always explicit). Confirmation is typed interactively, or given as
 * `--confirm=atlasbi` for scripted use. `.env` is configuration, not data, and is left untouched;
 * the DuckDB extensions are a cache, not data, and are kept so no download is needed afterwards.
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
  await rm(WORKSPACE_FILES.lakehouseDataDirectory, { recursive: true, force: true });
  console.log(`Removed ${WORKSPACE_FILES.lakehouseDataDirectory}.`);
  console.log(
    '\nLocal stack and its data removed. A custom ATLASBI_LAKEHOUSE_DATA_PATH outside .data/ is never deleted.' +
      '\nRun `pnpm bootstrap` to start from scratch.',
  );
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
      `This permanently deletes all local data (every volume of the "${PROJECT_NAME}" stack and the lakehouse in .data/lakehouse).\n` +
        `Type "${PROJECT_NAME}" to confirm: `,
    );
    return answer.trim() === PROJECT_NAME;
  } finally {
    prompt.close();
  }
}
