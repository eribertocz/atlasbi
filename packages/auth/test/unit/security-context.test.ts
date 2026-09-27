import { AccessDeniedError, type Identity } from '@atlasbi/contracts';
import { describe, expect, it } from 'vitest';

import { buildSecurityContext } from '../../src/access/security-context.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const WORKSPACE = { id: '33333333-3333-4333-8333-333333333333', organizationId: ORG };
const IDENTITY: Identity = { userId: '44444444-4444-4444-8444-444444444444', organizationId: ORG };

function denial(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof AccessDeniedError ? error.reason : 'not an AccessDeniedError';
  }
  return undefined;
}

describe('buildSecurityContext', () => {
  it('combines the role (what they can do) and the entitlements (what they can see)', () => {
    const context = buildSecurityContext(IDENTITY, WORKSPACE, { role: 'viewer' }, [
      { dimension: 'region', allValues: false, allowedValues: ['North', 'South'] },
      { dimension: 'category', allValues: true, allowedValues: [] },
    ]);

    expect(context).toEqual({
      userId: IDENTITY.userId,
      organizationId: ORG,
      workspaceId: WORKSPACE.id,
      workspaceRole: 'viewer',
      entitlements: {
        region: { kind: 'listed', values: ['North', 'South'] },
        category: { kind: 'all' },
      },
    });
  });

  it('denies another organization, a missing workspace, a missing membership and an unknown role', () => {
    expect(denial(() => buildSecurityContext(IDENTITY, undefined, { role: 'admin' }, []))).toBe(
      'workspace_not_found',
    );
    expect(
      denial(() =>
        buildSecurityContext(
          IDENTITY,
          { ...WORKSPACE, organizationId: OTHER_ORG },
          { role: 'admin' },
          [],
        ),
      ),
    ).toBe('other_organization');
    expect(denial(() => buildSecurityContext(IDENTITY, WORKSPACE, undefined, []))).toBe(
      'not_a_member',
    );
    expect(denial(() => buildSecurityContext(IDENTITY, WORKSPACE, { role: 'owner' }, []))).toBe(
      'not_a_member',
    );
  });

  it('grants nothing for a dimension without a grant, or with a row the constraints forbid', () => {
    const context = buildSecurityContext(IDENTITY, WORKSPACE, { role: 'viewer' }, [
      { dimension: 'region', allValues: false, allowedValues: [] },
      { dimension: 'category', allValues: true, allowedValues: ['Hardware'] },
    ]);

    // Never an empty list, never "all" by accident: the dimension stays denied.
    expect(context.entitlements).toEqual({});
  });

  it('never lets the role decide which rows are visible', () => {
    const admin = buildSecurityContext(IDENTITY, WORKSPACE, { role: 'admin' }, []);

    expect(admin.workspaceRole).toBe('admin');
    expect(admin.entitlements).toEqual({});
  });
});
