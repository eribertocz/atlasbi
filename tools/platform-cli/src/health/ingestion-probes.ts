import { INGESTION_SOURCES, runIngestion, syncIngestionEnvironment } from '@atlasbi/ingestion';
import type { LakehouseSettings } from '@atlasbi/warehouse';

import type { ReadinessStep } from './readiness-chain.ts';

const ENVIRONMENT_STEP = 'Ingestion environment';

/**
 * Bootstrap only: the Python environment of packages/ingestion (uv sync — the one download), then
 * the landing views, typed and empty until the first `pnpm ingest` — so transformation can be
 * planned before anything is ingested. `pnpm dev` does not ingest: it is a job, not a service
 * (docs/19 §1).
 */
export function ingestionBootstrapSteps(
  lakehouse: LakehouseSettings,
  dataDirectory: string,
): ReadinessStep[] {
  return [
    {
      name: ENVIRONMENT_STEP,
      ensureReady: async () => {
        const { python, tool, duckdb } = await syncIngestionEnvironment();
        return `Python ${python}, ${tool.name} ${tool.version}, DuckDB ${duckdb}`;
      },
    },
    {
      name: 'Ingestion landing',
      dependsOn: ['Lakehouse', ENVIRONMENT_STEP],
      ensureReady: async () => {
        const published: string[] = [];
        for (const source of INGESTION_SOURCES) {
          const { summary } = await runIngestion(
            source,
            { lakehouse, dataDirectory },
            { output: 'capture', landingOnly: true },
          );
          if (summary.error !== undefined) {
            throw new Error(`${source}: ${summary.error.message}`);
          }
          published.push(
            ...summary.landing.map(
              ({ table, rowsTotal }) => `${table.schema}.${table.name} (${rowsTotal} rows)`,
            ),
          );
        }
        return published.join(', ');
      },
    },
  ];
}
