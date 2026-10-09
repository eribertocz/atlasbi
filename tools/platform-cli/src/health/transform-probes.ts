import { ensureDatabaseExists } from '@atlasbi/database';
import { syncTransformEnvironment } from '@atlasbi/transform';

import { describeFailure } from '../lakehouse-environment.ts';
import type { ReadinessStep } from './readiness-chain.ts';

/**
 * Bootstrap only: the Python environment of packages/transform (uv sync — the one download) and
 * the transformation's state database. `pnpm dev` does not transform: it is a job, not a service
 * (docs/19 §1).
 */
export function transformBootstrapSteps(stateConnectionString: string): ReadinessStep[] {
  return [
    {
      name: 'Transform environment',
      ensureReady: async () => {
        const { python, tool, duckdb } = await syncTransformEnvironment();
        return `Python ${python}, ${tool.name} ${tool.version}, DuckDB ${duckdb}`;
      },
    },
    {
      name: 'Transform state',
      dependsOn: ['Postgres'],
      ensureReady: async () => {
        try {
          const database = await ensureDatabaseExists(stateConnectionString);
          return database === 'created' ? 'database created' : 'ready';
        } catch (error) {
          throw new Error(describeFailure(error), { cause: error });
        }
      },
    },
  ];
}
