import type { SecurityContext } from '@atlasbi/contracts';

/**
 * The dimensions the Cube model protects with access policies (cube/model/cubes/*.yml — a unit
 * test keeps both in step).
 *
 * ⚠ One protected dimension per cube (decision D1, build step 7). Cube combines the policies of
 * different groups with OR (docs/09 §6.1): in a cube protected by two dimensions, `region:all`
 * would lift the `repository` filter. Each group below only ever meets the policies of its own
 * dimension, and a unit test refuses a cube whose policies name two.
 */
export const PROTECTED_DIMENSIONS: readonly string[] = ['region', 'repository'];

/** What Cube receives: its access policies read `groups` and `entitlements`, nothing else. */
export interface QueryClaims {
  sub: string;
  org: string;
  workspace: string;
  groups: string[];
  entitlements: Record<string, string[]>;
}

/** The readiness probe of `pnpm dev`: it may read `regions.zone` and nothing else. */
export const READINESS_CLAIMS = { sub: 'platform-readiness', groups: ['readiness'] } as const;

/**
 * Translates the platform's security context to the groups of the Cube model (build step 4,
 * decision E2). Per protected dimension: an explicit "all" grant → `<dimension>:all`; a list →
 * `<dimension>:listed` plus the list, never empty; no grant → no group, and Cube denies. The
 * workspace role never decides rows (docs/09 §6.1), so it does not travel.
 */
export function toQueryClaims(context: SecurityContext): QueryClaims {
  const groups: string[] = [];
  const entitlements: Record<string, string[]> = {};
  for (const dimension of PROTECTED_DIMENSIONS) {
    const grant = context.entitlements[dimension];
    if (grant?.kind === 'all') {
      groups.push(`${dimension}:all`);
    } else if (grant?.kind === 'listed') {
      groups.push(`${dimension}:listed`);
      entitlements[dimension] = [...grant.values];
    }
  }
  return {
    sub: context.userId,
    org: context.organizationId,
    workspace: context.workspaceId,
    groups,
    entitlements,
  };
}
