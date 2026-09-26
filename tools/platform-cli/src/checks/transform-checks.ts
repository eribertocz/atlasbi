import { checkTransformEnvironment } from '@atlasbi/transform';

import type { CheckResult } from './check-result.ts';

/** Offline and read-only: is packages/transform/.venv exactly what uv.lock says? */
export async function checkTransform(): Promise<CheckResult> {
  const state = await checkTransformEnvironment();
  switch (state) {
    case 'synced':
      return { name: 'Transform environment', status: 'pass', detail: 'matches uv.lock' };
    case 'out-of-sync':
      return {
        name: 'Transform environment',
        status: 'warn',
        detail:
          'not prepared yet or out of date — `pnpm bootstrap` runs `uv sync` (needs Internet once)',
      };
    case 'missing-uv':
      return { name: 'Transform environment', status: 'warn', detail: 'needs uv (see above)' };
  }
}
