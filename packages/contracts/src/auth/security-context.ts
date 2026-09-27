/** Version of the security context the platform hands to the semantic layer (docs/09 §6.1). */
export const SECURITY_CONTEXT_VERSION = '1.0';

/** What someone can DO in a workspace — never which rows they see (docs/09 §6.1). */
export const WORKSPACE_ROLES = ['admin', 'editor', 'analyst', 'viewer'] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/**
 * What someone can SEE along one dimension. "All values" is an explicit grant, never the absence
 * of one: a protected dimension without a grant is denied (docs/09 §6.1).
 */
export type DataEntitlement =
  { kind: 'all' } | { kind: 'listed'; values: readonly [string, ...string[]] };

export interface SecurityContext {
  userId: string;
  organizationId: string;
  workspaceId: string;
  workspaceRole: WorkspaceRole;
  /** Keyed by dimension name (`region`…); only the dimensions this person has a grant for. */
  entitlements: Readonly<Record<string, DataEntitlement>>;
}

export const ACCESS_DENIED_REASONS = [
  'workspace_not_found',
  /** The workspace belongs to another organization than the one in the identity token. */
  'other_organization',
  'not_a_member',
] as const;

export type AccessDeniedReason = (typeof ACCESS_DENIED_REASONS)[number];

/** Rejected when a security context cannot be granted; the message never names the workspace. */
export class AccessDeniedError extends Error {
  readonly reason: AccessDeniedReason;

  constructor(reason: AccessDeniedReason) {
    super('Access to this workspace is denied.');
    this.name = 'AccessDeniedError';
    this.reason = reason;
  }
}
