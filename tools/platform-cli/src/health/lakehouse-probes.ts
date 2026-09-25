import type { LakehouseCatalogType } from '@atlasbi/contracts';
import { ensureDatabaseExists } from '@atlasbi/database';
import {
  createAnalyticalQueryEngine,
  createLakehouseAdmin,
  describeCatalogType,
  installLakehouseExtensions,
  provisionLakehouse,
  type ExtensionStatus,
  type LakehouseSettings,
} from '@atlasbi/warehouse';

import { describeFailure } from '../lakehouse-environment.ts';
import type { ReadinessStep } from './readiness-chain.ts';

export type LakehouseStartMode = 'bootstrap' | 'dev';

const EXTENSIONS_STEP = 'DuckDB extensions';
const SINGLE_WRITER_NOTE = 'single-writer mode — recommended for individual development';

/** The readiness line agreed for Step 1 — SQLite always carries its single-writer note. */
export function lakehouseReadinessDetail(catalogType: LakehouseCatalogType): string {
  const catalog = describeCatalogType(catalogType);
  return catalogType === 'sqlite'
    ? `healthy — Catalog: ${catalog} (${SINGLE_WRITER_NOTE})`
    : `healthy — Catalog: ${catalog}`;
}

export function describeExtensions(statuses: readonly ExtensionStatus[]): string {
  return statuses
    .map((status) =>
      status.state === 'ready'
        ? `${status.name} ${status.version ?? ''}`.trim()
        : `${status.name} (${status.state})`,
    )
    .join(', ');
}

/**
 * bootstrap: catalog database → extensions (the only download) → provisioning → health.
 * dev: health only — the runtime never installs, downloads or creates anything.
 */
export function lakehouseReadinessSteps(
  settings: LakehouseSettings,
  mode: LakehouseStartMode,
): ReadinessStep[] {
  const steps: ReadinessStep[] = [];
  if (mode === 'bootstrap') {
    steps.push({
      name: EXTENSIONS_STEP,
      ensureReady: async () => {
        const statuses = await installLakehouseExtensions(settings.extensionDirectory);
        if (statuses.some((status) => status.state !== 'ready')) {
          throw new Error(`not usable after installing: ${describeExtensions(statuses)}`);
        }
        return describeExtensions(statuses);
      },
    });
  }
  steps.push({
    name: 'Lakehouse',
    dependsOn: [
      ...(settings.catalog.type === 'postgres' ? ['Postgres'] : []),
      ...(mode === 'bootstrap' ? [EXTENSIONS_STEP] : []),
    ],
    ensureReady: async () => {
      try {
        if (mode === 'bootstrap') {
          if (settings.catalog.type === 'postgres') {
            await ensureDatabaseExists(settings.catalog.connectionString);
          }
          await provisionLakehouse(settings);
        }
        await verifyLakehouse(settings);
        return lakehouseReadinessDetail(settings.catalog.type);
      } catch (error) {
        throw new Error(describeFailure(error), { cause: error });
      }
    },
  });
  return steps;
}

/** Both ports must open: the admin one reports health, the read-only one proves the hardening holds. */
async function verifyLakehouse(settings: LakehouseSettings): Promise<void> {
  const admin = await createLakehouseAdmin(settings);
  try {
    await admin.checkHealth();
  } finally {
    await admin.close();
  }
  const reader = await createAnalyticalQueryEngine(settings);
  try {
    await reader.query('SELECT 1 AS ready');
  } finally {
    await reader.close();
  }
}
