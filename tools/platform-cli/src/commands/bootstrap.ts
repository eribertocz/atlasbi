import { ensureEnvFile } from '../local-environment.ts';
import { startLocalStack } from './dev.ts';

/** First run on a fresh clone: create .env, then everything `pnpm dev` does. */
export async function runBootstrap(): Promise<void> {
  const envFile = await ensureEnvFile();
  console.log(
    envFile === 'created'
      ? 'Created .env from .env.example.'
      : '.env already exists — left untouched.',
  );
  await startLocalStack();
  console.log('\nBootstrap complete. From now on, `pnpm dev` is the only command you need.');
}
