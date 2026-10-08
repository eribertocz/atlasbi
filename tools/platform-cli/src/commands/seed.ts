import {
  type AccessDirectory,
  createAccessDirectory,
  createBetterAuthIdentity,
  DEMO_ACCESS,
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
import type { DataEntitlement, IdentityPort } from '@atlasbi/contracts';
import { listPendingMigrations } from '@atlasbi/database';
import {
  createReportRepository,
  DEMO_REPORT,
  type ReportRepository,
  seedDemoReports,
} from '@atlasbi/reports';
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
 * Development data only, never run implicitly (docs/19 §6): the lakehouse dataset (Step 1), the
 * demo organization, workspaces and users of the MVP acceptance script (Step 4, docs/16 §4), and
 * the report they open (Step 6).
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
  const reports = createReportRepository({ connectionString: databaseUrl });
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

    await seedReports(identity, access, reports);
  } finally {
    await reports.close();
    await access.close();
    await identity.close();
  }
}

/** The demo report in every demo workspace, authored by the first demo user. */
async function seedReports(
  identity: IdentityPort,
  access: AccessDirectory,
  reports: ReportRepository,
): Promise<void> {
  const [author] = DEMO_ACCESS.users;
  const organization = await identity.findOrganizationBySlug(DEMO_ACCESS.organization.slug);
  const createdBy = (await identity.findUserByEmail(author.email))?.userId;
  if (organization === undefined || createdBy === undefined) {
    throw new Error('demo reports: the demo organization and users must exist first');
  }
  const targets = [];
  for (const { slug } of DEMO_ACCESS.workspaces) {
    const workspace = await access.findWorkspace(organization.organizationId, slug);
    if (workspace === undefined) {
      throw new Error(`demo reports: the demo workspace ${slug} must exist first`);
    }
    targets.push({ slug, workspaceId: workspace.workspaceId, createdBy });
  }

  const rows = await seedDemoReports(reports, targets);
  console.log(`
Demo report "${DEMO_REPORT.name}":`);
  for (const [index, row] of rows.entries()) {
    const slug = targets[index]?.slug ?? row.workspaceId;
    console.log(`  ${slug.padEnd(10)} ${row.created ? 'created' : 'already there'}`);
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
