import {
  createAccessDirectory,
  createBetterAuthIdentity,
  type DemoAccessRow,
  MIN_PASSWORD_LENGTH,
  seedDemoAccess,
} from '@atlasbi/auth';
import {
  assertSecretsAvailable,
  authSecretKeys,
  createSecretProvider,
  loadConfig,
  requiredSecretKeys,
  SECRET_KEYS,
} from '@atlasbi/config';
import type { DataEntitlement } from '@atlasbi/contracts';
import { listPendingMigrations } from '@atlasbi/database';
import {
  createAnalyticalQueryEngine,
  createLakehouseAdmin,
  describeCatalogType,
  type LakehouseSettings,
  seedDevelopmentDataset,
} from '@atlasbi/warehouse';

import { resolveLakehouseSettings } from '../lakehouse-environment.ts';
import { loadEnvFile } from '../local-environment.ts';
import { WORKSPACE_ROOT } from '../workspace-paths.ts';

/**
 * Development data only, never run implicitly (docs/19 §6): the lakehouse dataset (Step 1) and the
 * demo organization, workspaces and users of the MVP acceptance script (Step 4, docs/16 §4).
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
  await assertSecretsAvailable(secrets, [
    ...requiredSecretKeys(config.lakehouse),
    ...authSecretKeys(),
    SECRET_KEYS.seedDemoPassword,
  ]);
  const databaseUrl = await secrets.get(SECRET_KEYS.databaseUrl);
  const pending = await listPendingMigrations({ connectionString: databaseUrl });
  if (pending.length > 0) {
    throw new Error(
      `The platform database is missing migrations (${pending.join(', ')}): run \`pnpm dev\` first — it applies them.`,
    );
  }
  // Every setting is checked before anything is written: a bad secret fails here, not halfway.
  const demoPassword = await secrets.get(SECRET_KEYS.seedDemoPassword);
  if (demoPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `seed.demo-password (ATLASBI_SEED_DEMO_PASSWORD) must have at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  const identity = createBetterAuthIdentity({
    connectionString: databaseUrl,
    secret: await secrets.get(SECRET_KEYS.authSecret),
  });
  const access = createAccessDirectory({ connectionString: databaseUrl });
  try {
    await seedLakehouse(await resolveLakehouseSettings(config.lakehouse, secrets));

    const demo = await seedDemoAccess(identity, access, demoPassword);
    // The password is never printed: it is the seed.demo-password secret.
    console.log(
      `\nDemo access (organization ${demo.organizationSlug}), each checked by signing in — password: ATLASBI_SEED_DEMO_PASSWORD`,
    );
    for (const row of demo.rows) {
      console.log(`  ${describeAccess(row)}`);
    }
  } finally {
    await access.close();
    await identity.close();
  }
}

async function seedLakehouse(settings: LakehouseSettings): Promise<void> {
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

function describeAccess(row: DemoAccessRow): string {
  return `${row.email.padEnd(19)} ${row.workspace.padEnd(10)} ${row.role.padEnd(7)} region: ${describeEntitlement(row.region)}`;
}

function describeEntitlement(entitlement: DataEntitlement | undefined): string {
  if (entitlement === undefined) {
    return 'none (denied)';
  }
  return entitlement.kind === 'all' ? 'all' : entitlement.values.join(', ');
}
