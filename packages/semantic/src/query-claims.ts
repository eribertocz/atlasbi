import type { SecurityContext } from '@atlasbi/contracts';

/**
 * The dimensions the Cube model protects with access policies (cube/model/cubes/*.yml — a unit
 * test keeps both in step). One today.
 *
 * ⚠ Before adding a second one, read docs/09 §6.1: Cube combines policies of different groups with
 * OR, so one group per dimension would let `region:all` lift every other restriction. The mapping
 * below refuses more than one dimension until it is redesigned.
 */
export const PROTECTED_DIMENSIONS: readonly string[] = ['region'];

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
  if (PROTECTED_DIMENSIONS.length !== 1) {
    throw new Error(
      'More than one protected dimension needs a redesigned mapping first (docs/09 §6.1).',
    );
  }
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
