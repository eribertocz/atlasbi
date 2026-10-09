import { rm } from 'node:fs/promises';

import { composeDown, ensureEngineRunning } from '../container-runtime/podman.ts';
import { hasEnvFile, loadEnvFile } from '../local-environment.ts';
import { confirmByTyping } from '../system/confirmation.ts';
import { LOCAL_DATA_DIRECTORIES, PROJECT_NAME } from '../workspace-paths.ts';

/**
 * Destroys the local stack including its data volumes, the lakehouse folder and the ingestion's
 * local state of that lakehouse (docs/19 §2: destructive, always explicit). The ingestion folder
 * goes too, rather than trusting the tool to notice a recreated lakehouse on its own.
 * Confirmation is typed interactively, or given as `--confirm=atlasbi` for scripted use. `.env` is
 * configuration, not data, and is left untouched;
 * the DuckDB extensions are a cache, not data, and are kept so no download is needed afterwards.
 */
export async function runResetLocal(args: readonly string[]): Promise<void> {
  const confirmed = await confirmByTyping(
    args,
    `reset:local permanently deletes all local data (every volume of the "${PROJECT_NAME}" stack and the lakehouse and the ingestion state in .data/lakehouse and .data/ingestion).`,
  );
  if (!confirmed) {
    console.log('Cancelled — nothing was deleted.');
    return;
  }
  if (hasEnvFile()) {
    loadEnvFile();
  }
  await ensureEngineRunning();
  await composeDown({ removeVolumes: true });
  for (const directory of LOCAL_DATA_DIRECTORIES) {
    await rm(directory, { recursive: true, force: true });
    console.log(`Removed ${directory}.`);
  }
  console.log(
    '\nLocal stack and its data removed. A custom ATLASBI_LAKEHOUSE_DATA_PATH or ATLASBI_INGESTION_DATA_PATH outside .data/ is never deleted.' +
      '\nRun `pnpm bootstrap` to start from scratch.',
  );
}
