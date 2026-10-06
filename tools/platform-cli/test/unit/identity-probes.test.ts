import { describe, expect, it } from 'vitest';

import { describeMissing, describeOrphaned } from '../../src/health/identity-probes.ts';

const result = (
  missing: [number, number],
  orphaned: [number, number],
): Parameters<typeof describeMissing>[0] => ({
  missing: {
    principals: [...Array(missing[0]).keys()].map((index) => `p${index}`),
    organizations: [...Array(missing[1]).keys()].map((index) => `o${index}`),
  },
  orphaned: {
    principals: [...Array(orphaned[0]).keys()].map((index) => `x${index}`),
    organizations: [...Array(orphaned[1]).keys()].map((index) => `y${index}`),
  },
  repaired: false,
});

describe('identity drift, in words', () => {
  it('says nothing when the platform and the provider are in step', () => {
    expect(describeMissing(result([0, 0], [0, 0]))).toBeUndefined();
    expect(describeOrphaned(result([0, 0], [0, 0]))).toBeUndefined();
  });

  it('counts what is missing and what is unknown to the provider', () => {
    expect(describeMissing(result([2, 1], [0, 0]))).toBe(
      "2 people and 1 organization missing from the platform's identity",
    );
    expect(describeMissing(result([1, 0], [0, 0]))).toBe(
      "1 person missing from the platform's identity",
    );
    expect(describeOrphaned(result([0, 0], [1, 2]))).toBe(
      '1 principal and 2 organizations unknown to the identity provider',
    );
  });
});
