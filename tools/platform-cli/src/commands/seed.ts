import {
  assertSecretsAvailable,
  createSecretProvider,
  loadConfig,
  requiredSecretKeys,
} from '@atlasbi/config';
import {
  createAnalyticalQueryEngine,
  createLakehouseAdmin,
  describeCatalogType,
  seedDevelopmentDataset,
} from '@atlasbi/warehouse';

import { resolveLakehouseSettings } from '../lakehouse-environment.ts';
import { loadEnvFile } from '../local-environment.ts';
import { WORKSPACE_ROOT } from '../workspace-paths.ts';

/**
 * Development data only, never run implicitly (docs/19 §6). In Step 1 that is the lakehouse
 * dataset; the demo organization and users join in Step 4 (Auth).
 */
export async function runSeed(): Promise<void> {
  loadEnvFile();
  const config = loadConfig(process.env, { baseDirectory: WORKSPACE_ROOT });
  if (config.environment === 'production') {
    throw new Error(
      '`pnpm seed` loads development data and refuses to run with ATLASBI_ENV=production.',
    );
  }
  const secrets = createSecretProvider(config);
  await assertSecretsAvailable(secrets, requiredSecretKeys(config.lakehouse));
  const settings = await resolveLakehouseSettings(config.lakehouse, secrets);

  const admin = await createLakehouseAdmin(settings);
  let seeded;
  let health;
  try {
    seeded = await seedDevelopmentDataset(admin);
    health = await admin.checkHealth();
  } finally {
    await admin.close();
  }

  const reader = await createAnalyticalQueryEngine(settings);
  let visibleRows;
  try {
    const result = await reader.query(`SELECT count(*) FROM ${seeded.table}`);
    const count = result.rows[0]?.[0];
    visibleRows = typeof count === 'string' ? count : '0';
  } finally {
    await reader.close();
  }

  console.log(
    `Seeded ${seeded.table}: ${visibleRows} rows readable (Catalog: ${describeCatalogType(health.catalogType)}).`,
  );
  console.log(`Rows pending in the catalog after the flush: ${health.inlining.pendingRows}.`);
}
