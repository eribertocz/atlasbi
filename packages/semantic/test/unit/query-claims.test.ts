import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SecurityContext } from '@atlasbi/contracts';
import { describe, expect, it } from 'vitest';

import { PROTECTED_DIMENSIONS, READINESS_CLAIMS, toQueryClaims } from '../../src/index.ts';

const MODEL = fileURLToPath(new URL('../../cube/model/cubes', import.meta.url));

function context(entitlements: SecurityContext['entitlements']): SecurityContext {
  return {
    userId: '44444444-4444-4444-8444-444444444444',
    organizationId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '33333333-3333-4333-8333-333333333333',
    workspaceRole: 'viewer',
    entitlements,
  };
}

describe('toQueryClaims (security context → Cube groups, decision E2)', () => {
  it('turns an explicit "all" grant into the region:all group', () => {
    expect(toQueryClaims(context({ region: { kind: 'all' } }))).toEqual({
      sub: '44444444-4444-4444-8444-444444444444',
      org: '11111111-1111-4111-8111-111111111111',
      workspace: '33333333-3333-4333-8333-333333333333',
      groups: ['region:all'],
      entitlements: {},
    });
  });

  it('turns a list into region:listed plus the list', () => {
    const claims = toQueryClaims(
      context({ region: { kind: 'listed', values: ['North', 'South'] } }),
    );

    expect(claims.groups).toEqual(['region:listed']);
    expect(claims.entitlements).toEqual({ region: ['North', 'South'] });
  });

  it('gives no group without a grant — Cube then denies — and never sends the role', () => {
    const claims = toQueryClaims({ ...context({}), workspaceRole: 'admin' });

    expect(claims.groups).toEqual([]);
    expect(claims.entitlements).toEqual({});
    expect(JSON.stringify(claims)).not.toContain('admin');
  });

  it('ignores grants on dimensions the model does not protect', () => {
    const claims = toQueryClaims(context({ category: { kind: 'all' } }));

    expect(claims.groups).toEqual([]);
  });

  it('keeps the readiness probe to its own group', () => {
    expect(READINESS_CLAIMS.groups).toEqual(['readiness']);
  });
});

describe('the access policies of the model', () => {
  const files = readdirSync(MODEL).filter((file) => file.endsWith('.yml'));
  const models = files.map((file) => ({
    file,
    text: readFileSync(path.join(MODEL, file), 'utf8'),
  }));

  it('protect exactly the dimensions the mapping knows — one, until docs/09 §6.1 is redesigned', () => {
    const referenced = new Set(
      models.flatMap(({ text }) =>
        [...text.matchAll(/securityContext\.entitlements\.([a-z][a-z0-9_]*)/g)].map(
          (match) => match[1],
        ),
      ),
    );

    expect([...referenced].sort()).toEqual([...PROTECTED_DIMENSIONS].sort());
    expect(PROTECTED_DIMENSIONS).toHaveLength(1);
  });

  it('give every cube that filters on a dimension both its listed and its all group', () => {
    for (const { file, text } of models) {
      for (const dimension of PROTECTED_DIMENSIONS) {
        if (text.includes(`securityContext.entitlements.${dimension}`)) {
          expect(text, file).toContain(`group: '${dimension}:listed'`);
          expect(text, file).toContain(`group: '${dimension}:all'`);
        }
      }
    }
  });

  it('never declare a policy without a group: it would apply to everyone', () => {
    for (const { file, text } of models) {
      const lines = text.split('\n');
      const start = lines.findIndex((line) => line.trim() === 'access_policy:');
      if (start === -1) {
        continue;
      }
      const indent = (lines[start]?.length ?? 0) - (lines[start]?.trimStart().length ?? 0);
      const policies = lines
        .slice(start + 1)
        .filter((line) => line.length - line.trimStart().length === indent + 2)
        .filter((line) => line.trimStart().startsWith('- '));

      expect(policies.length, file).toBeGreaterThan(0);
      for (const policy of policies) {
        expect(policy.trimStart(), file).toMatch(/^- group: /);
      }
    }
  });
});
