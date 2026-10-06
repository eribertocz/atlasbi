import { createBetterAuthIdentity } from '@atlasbi/auth';
import {
  assertSecretsAvailable,
  authSecretKeys,
  createSecretProvider,
  loadConfig,
  SECRET_KEYS,
} from '@atlasbi/config';
import { listPendingMigrations } from '@atlasbi/database';

import type { CheckResult } from '../checks/check-result.ts';
import { describeMissing, describeOrphaned } from '../health/identity-probes.ts';
import { loadEnvFile } from '../local-environment.ts';
import { printChecks } from '../output/console-report.ts';
import { WORKSPACE_ROOT } from '../workspace-paths.ts';

/**
 * Repairs the platform's identity (docs/09 §6.4): adds every person and organization the identity
 * provider knows and the platform does not. Never deletes anything — what the platform knows and the
 * provider does not is listed for a person to decide.
 */
export async function runIdentityReconcile(): Promise<void> {
  loadEnvFile();
  const config = loadConfig(process.env, { baseDirectory: WORKSPACE_ROOT });
  const secrets = createSecretProvider(config);
  await assertSecretsAvailable(secrets, [SECRET_KEYS.databaseUrl, ...authSecretKeys()]);
  const databaseUrl = await secrets.get(SECRET_KEYS.databaseUrl);
  const pending = await listPendingMigrations({ connectionString: databaseUrl });
  if (pending.length > 0) {
    throw new Error(
      `The platform database is missing migrations (${pending.join(', ')}): run \`pnpm dev\` first — it applies them.`,
    );
  }

  const identity = createBetterAuthIdentity({
    connectionString: databaseUrl,
    secret: await secrets.get(SECRET_KEYS.authSecret),
  });
  try {
    const result = await identity.reconcile({ repair: true });
    const missing = describeMissing(result);
    const orphaned = describeOrphaned(result);
    const checks: CheckResult[] = [
      missing === undefined
        ? { name: 'Missing', status: 'pass', detail: 'nothing — the platform knows everyone' }
        : { name: 'Missing', status: 'pass', detail: `${missing}: added` },
      orphaned === undefined
        ? { name: 'Unknown', status: 'pass', detail: 'nothing' }
        : {
            name: 'Unknown',
            status: 'warn',
            detail: `${orphaned}, left as they are: ${[
              ...result.orphaned.principals.map((id) => `principal ${id}`),
              ...result.orphaned.organizations.map((id) => `organization ${id}`),
            ].join(', ')}`,
            remedy:
              'Nothing is ever deleted automatically. Check whether a workspace still needs them before removing them by hand.',
          },
    ];
    printChecks('Identity reconciliation', checks);
  } finally {
    await identity.close();
  }
}
