import { checkIngestionEnvironment } from '@atlasbi/ingestion';

import type { CheckResult } from './check-result.ts';

/** Offline and read-only: is packages/ingestion/.venv exactly what uv.lock says? */
export async function checkIngestion(): Promise<CheckResult> {
  const state = await checkIngestionEnvironment();
  switch (state) {
    case 'synced':
      return { name: 'Ingestion environment', status: 'pass', detail: 'matches uv.lock' };
    case 'out-of-sync':
      return {
        name: 'Ingestion environment',
        status: 'warn',
        detail:
          'not prepared yet or out of date — `pnpm bootstrap` runs `uv sync` (needs Internet once)',
      };
    case 'missing-uv':
      return { name: 'Ingestion environment', status: 'warn', detail: 'needs uv (see above)' };
  }
}
