import {
  type DataEntitlement,
  type Identity,
  type SecurityContext,
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from '@atlasbi/contracts';
import { CamelCasePlugin, type Generated, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import { buildSecurityContext } from './security-context.ts';

// The `access` schema (migration 000002). Rows never leave this package (docs/21 §9).
interface AccessTables {
  workspace: {
    id: Generated<string>;
    organizationId: string;
    slug: string;
    name: string;
    createdAt: Generated<Date>;
  };
  workspaceMembership: {
    workspaceId: string;
    userId: string;
    role: string;
    createdAt: Generated<Date>;
  };
  dataEntitlements: {
    workspaceId: string;
    userId: string;
    dimension: string;
    allValues: boolean;
    allowedValues: string[];
    createdAt: Generated<Date>;
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DIMENSION = /^[a-z][a-z0-9_]*$/;

export class InvalidAccessRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAccessRequestError';
  }
}

/**
 * The platform's own authorization (docs/09 §6.1–§6.2): workspaces, the role someone has in each,
 * and what data they can see — two separate questions, resolved per request.
 */
export interface AccessDirectory {
  createWorkspace(workspace: {
    organizationId: string;
    slug: string;
    name: string;
  }): Promise<{ workspaceId: string }>;
  findWorkspace(organizationId: string, slug: string): Promise<{ workspaceId: string } | undefined>;
  /** Grants or changes the role of a user in a workspace. */
  setMembership(membership: {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
  }): Promise<void>;
  /** Grants or replaces what a member can see along one dimension. */
  grantEntitlement(grant: {
    workspaceId: string;
    userId: string;
    dimension: string;
    entitlement: DataEntitlement;
  }): Promise<void>;
  revokeEntitlement(grant: {
    workspaceId: string;
    userId: string;
    dimension: string;
  }): Promise<void>;
  /** Rejects with AccessDeniedError; never resolves with a partial context. */
  resolveSecurityContext(identity: Identity, workspaceId: string): Promise<SecurityContext>;
  close(): Promise<void>;
}

export function createAccessDirectory(options: { connectionString: string }): AccessDirectory {
  const pool = new pg.Pool({ connectionString: options.connectionString, max: 5 });
  const db = new Kysely<AccessTables>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  }).withSchema('access');

  return {
    async createWorkspace({ organizationId, slug, name }) {
      if (!UUID.test(organizationId) || !SLUG.test(slug) || name.trim() === '') {
        throw new InvalidAccessRequestError(
          'A workspace needs an organization id, a lowercase slug and a name.',
        );
      }
      const { id } = await db
        .insertInto('workspace')
        .values({ organizationId, slug, name: name.trim() })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { workspaceId: id };
    },

    async findWorkspace(organizationId, slug) {
      if (!UUID.test(organizationId)) {
        return undefined;
      }
      const row = await db
        .selectFrom('workspace')
        .select('id')
        .where('organizationId', '=', organizationId)
        .where('slug', '=', slug)
        .executeTakeFirst();
      return row ? { workspaceId: row.id } : undefined;
    },

    async setMembership({ workspaceId, userId, role }) {
      if (!(WORKSPACE_ROLES as readonly string[]).includes(role)) {
        throw new InvalidAccessRequestError(`Unknown workspace role: ${role}.`);
      }
      await db
        .insertInto('workspaceMembership')
        .values({ workspaceId, userId, role })
        .onConflict((conflict) => conflict.columns(['workspaceId', 'userId']).doUpdateSet({ role }))
        .execute();
    },

    async grantEntitlement({ workspaceId, userId, dimension, entitlement }) {
      if (!DIMENSION.test(dimension)) {
        throw new InvalidAccessRequestError(`Not a dimension name: ${dimension}.`);
      }
      const allowedValues =
        entitlement.kind === 'all' ? [] : [...new Set(entitlement.values.map((v) => v.trim()))];
      if (entitlement.kind === 'listed' && allowedValues.some((value) => value === '')) {
        throw new InvalidAccessRequestError('An entitlement lists non-empty values only.');
      }
      const values = { allValues: entitlement.kind === 'all', allowedValues };
      await db
        .insertInto('dataEntitlements')
        .values({ workspaceId, userId, dimension, ...values })
        .onConflict((conflict) =>
          conflict.columns(['workspaceId', 'userId', 'dimension']).doUpdateSet(values),
        )
        .execute();
    },

    async revokeEntitlement({ workspaceId, userId, dimension }) {
      await db
        .deleteFrom('dataEntitlements')
        .where('workspaceId', '=', workspaceId)
        .where('userId', '=', userId)
        .where('dimension', '=', dimension)
        .execute();
    },

    async resolveSecurityContext(identity, workspaceId) {
      if (!UUID.test(workspaceId) || !UUID.test(identity.userId)) {
        return buildSecurityContext(identity, undefined, undefined, []);
      }
      // Two separate questions, two queries (docs/09 §6.1): what they can do, what they can see.
      const [workspace, membership, entitlements] = await Promise.all([
        db
          .selectFrom('workspace')
          .select(['id', 'organizationId'])
          .where('id', '=', workspaceId)
          .executeTakeFirst(),
        db
          .selectFrom('workspaceMembership')
          .select('role')
          .where('workspaceId', '=', workspaceId)
          .where('userId', '=', identity.userId)
          .executeTakeFirst(),
        db
          .selectFrom('dataEntitlements')
          .select(['dimension', 'allValues', 'allowedValues'])
          .where('workspaceId', '=', workspaceId)
          .where('userId', '=', identity.userId)
          .execute(),
      ]);
      return buildSecurityContext(identity, workspace, membership, entitlements);
    },

    async close() {
      await pool.end();
    },
  };
}
