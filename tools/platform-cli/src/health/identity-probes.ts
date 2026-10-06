import { createBetterAuthIdentity } from '@atlasbi/auth';
import type { IdentityReconciliation } from '@atlasbi/contracts';

import { MIGRATIONS_STEP } from './local-stack-probes.ts';
import type { ReadinessStep } from './readiness-chain.ts';

export const IDENTITY_STEP = 'Identity';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What is missing from the platform's identity, in words; undefined when nothing is. */
export function describeMissing(result: IdentityReconciliation): string | undefined {
  const { principals, organizations } = result.missing;
  if (principals.length + organizations.length === 0) {
    return undefined;
  }
  const parts = [
    principals.length > 0 ? plural(principals.length, 'person', 'people') : '',
    organizations.length > 0 ? plural(organizations.length, 'organization', 'organizations') : '',
  ].filter(Boolean);
  return `${parts.join(' and ')} missing from the platform's identity`;
}

/** What the platform knows that the provider does not; undefined when nothing. */
export function describeOrphaned(result: IdentityReconciliation): string | undefined {
  const { principals, organizations } = result.orphaned;
  if (principals.length + organizations.length === 0) {
    return undefined;
  }
  const parts = [
    principals.length > 0 ? plural(principals.length, 'principal', 'principals') : '',
    organizations.length > 0 ? plural(organizations.length, 'organization', 'organizations') : '',
  ].filter(Boolean);
  return `${parts.join(' and ')} unknown to the identity provider`;
}

/**
 * `pnpm dev` only detects (docs/09 §6.4): something missing fails the step with its remedy; a
 * principal the provider does not know is reported, never deleted — nothing can repair it on its
 * own, so it does not block the stack.
 */
export function identityReadinessStep(options: {
  connectionString: string;
  authSecret: string;
}): ReadinessStep {
  return {
    name: IDENTITY_STEP,
    dependsOn: [MIGRATIONS_STEP],
    ensureReady: async () => {
      const identity = createBetterAuthIdentity({
        connectionString: options.connectionString,
        secret: options.authSecret,
      });
      try {
        const result = await identity.reconcile();
        const missing = describeMissing(result);
        if (missing !== undefined) {
          throw new Error(`${missing} — run \`pnpm identity:reconcile\``);
        }
        const orphaned = describeOrphaned(result);
        return orphaned === undefined
          ? 'in step with the identity provider'
          : `in step; ${orphaned} — \`pnpm identity:reconcile\` lists them`;
      } finally {
        await identity.close();
      }
    },
  };
}
