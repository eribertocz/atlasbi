import {
  AccessDeniedError,
  type DataEntitlement,
  type Identity,
  type SecurityContext,
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from '@atlasbi/contracts';

export interface WorkspaceRow {
  id: string;
  organizationId: string;
}

export interface MembershipRow {
  role: string;
}

export interface EntitlementRow {
  dimension: string;
  allValues: boolean;
  allowedValues: readonly string[];
}

/**
 * Combines the two answers — what someone can DO (membership) and what they can SEE
 * (entitlements) — into the security context, only here (docs/09 §6.1). Denies instead of
 * guessing: another organization's workspace, no membership, or a row the database constraints
 * should have made impossible.
 */
export function buildSecurityContext(
  identity: Identity,
  workspace: WorkspaceRow | undefined,
  membership: MembershipRow | undefined,
  entitlements: readonly EntitlementRow[],
): SecurityContext {
  if (workspace === undefined) {
    throw new AccessDeniedError('workspace_not_found');
  }
  if (workspace.organizationId !== identity.organizationId) {
    throw new AccessDeniedError('other_organization');
  }
  if (membership === undefined || !isWorkspaceRole(membership.role)) {
    throw new AccessDeniedError('not_a_member');
  }
  return {
    userId: identity.userId,
    organizationId: identity.organizationId,
    workspaceId: workspace.id,
    workspaceRole: membership.role,
    entitlements: Object.fromEntries(
      entitlements.flatMap((row) => {
        const entitlement = toEntitlement(row);
        return entitlement === undefined ? [] : [[row.dimension, entitlement] as const];
      }),
    ),
  };
}

// An inconsistent row grants nothing: it is dropped, and the dimension stays denied.
function toEntitlement(row: EntitlementRow): DataEntitlement | undefined {
  if (row.allValues) {
    return row.allowedValues.length === 0 ? { kind: 'all' } : undefined;
  }
  const [first, ...rest] = row.allowedValues;
  return first === undefined ? undefined : { kind: 'listed', values: [first, ...rest] };
}

function isWorkspaceRole(role: string): role is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(role);
}
