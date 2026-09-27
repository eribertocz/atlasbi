import {
  AuthenticationError,
  type DataEntitlement,
  type IdentityPort,
  type WorkspaceRole,
} from '@atlasbi/contracts';

import type { AccessDirectory } from './access/access-directory.ts';

interface DemoGrant {
  user: string;
  workspace: string;
  role: WorkspaceRole;
  region: DataEntitlement;
}

/**
 * Development data only (docs/19 §6): the scenario of the MVP acceptance script (docs/16 §4). The
 * same person with a different role per workspace, and two viewers who see different regions of
 * the same metric (docs/09 §6.1–§6.2).
 */
export const DEMO_ACCESS = {
  organization: { slug: 'demo', name: 'Demo' },
  users: [
    { email: 'ana@example.com', name: 'Ana' },
    { email: 'bruno@example.com', name: 'Bruno' },
  ],
  workspaces: [
    { slug: 'comercial', name: 'Comercial' },
    { slug: 'finanzas', name: 'Finanzas' },
  ],
  grants: [
    { user: 'ana@example.com', workspace: 'comercial', role: 'admin', region: { kind: 'all' } },
    {
      user: 'ana@example.com',
      workspace: 'finanzas',
      role: 'viewer',
      region: { kind: 'listed', values: ['North'] },
    },
    {
      user: 'bruno@example.com',
      workspace: 'finanzas',
      role: 'viewer',
      region: { kind: 'listed', values: ['South'] },
    },
  ] satisfies DemoGrant[],
} as const;

export interface DemoAccessRow {
  email: string;
  workspace: string;
  role: WorkspaceRole;
  region: DataEntitlement | undefined;
}

export class DemoPasswordMismatchError extends Error {
  readonly remedy: string;

  constructor(email: string) {
    super(`The demo user ${email} already exists with another password.`);
    this.name = 'DemoPasswordMismatchError';
    this.remedy =
      'Put the previous value back in ATLASBI_SEED_DEMO_PASSWORD, or start over with `pnpm reset:local` and `pnpm bootstrap`.';
  }
}

/**
 * Idempotent: creates what is missing and sets roles and grants to the scenario. Then proves every
 * grant the way a request will (build step 5): sign in → identity token → security context — and
 * reports what the database resolves, not what it meant to write.
 */
export async function seedDemoAccess(
  identity: IdentityPort,
  access: AccessDirectory,
  password: string,
): Promise<{ organizationSlug: string; rows: DemoAccessRow[] }> {
  const userIds = new Map<string, string>();
  for (const user of DEMO_ACCESS.users) {
    const existing = await identity.findUserByEmail(user.email);
    const { userId } = existing ?? (await identity.createUser({ ...user, password }));
    userIds.set(user.email, userId);
  }
  const owner = requireId(userIds, DEMO_ACCESS.users[0].email);
  const { organizationId } =
    (await identity.findOrganizationBySlug(DEMO_ACCESS.organization.slug)) ??
    (await identity.createOrganization({ ...DEMO_ACCESS.organization, ownerUserId: owner }));
  for (const userId of userIds.values()) {
    await identity.addOrganizationMember({ organizationId, userId });
  }

  const workspaceIds = new Map<string, string>();
  for (const workspace of DEMO_ACCESS.workspaces) {
    const { workspaceId } =
      (await access.findWorkspace(organizationId, workspace.slug)) ??
      (await access.createWorkspace({ organizationId, ...workspace }));
    workspaceIds.set(workspace.slug, workspaceId);
  }
  for (const grant of DEMO_ACCESS.grants) {
    const workspaceId = requireId(workspaceIds, grant.workspace);
    const userId = requireId(userIds, grant.user);
    await access.setMembership({ workspaceId, userId, role: grant.role });
    await access.grantEntitlement({
      workspaceId,
      userId,
      dimension: 'region',
      entitlement: grant.region,
    });
  }

  const rows: DemoAccessRow[] = [];
  for (const grant of DEMO_ACCESS.grants) {
    let sessionToken: string;
    try {
      ({ sessionToken } = await identity.signIn({ email: grant.user, password }));
    } catch (error) {
      if (error instanceof AuthenticationError && error.code === 'invalid_credentials') {
        throw new DemoPasswordMismatchError(grant.user);
      }
      throw error;
    }
    try {
      const verified = await identity.verifyIdentityToken(
        await identity.issueIdentityToken(sessionToken),
      );
      const context = await access.resolveSecurityContext(
        verified,
        requireId(workspaceIds, grant.workspace),
      );
      rows.push({
        email: grant.user,
        workspace: grant.workspace,
        role: context.workspaceRole,
        region: context.entitlements.region,
      });
    } finally {
      await identity.signOut(sessionToken);
    }
  }
  return { organizationSlug: DEMO_ACCESS.organization.slug, rows };
}

function requireId(ids: Map<string, string>, key: string): string {
  const id = ids.get(key);
  if (id === undefined) {
    throw new Error(`demo access: ${key} was not created`);
  }
  return id;
}
