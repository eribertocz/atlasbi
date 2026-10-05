import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DataEntitlement, SecurityContext } from '../auth/security-context.ts';
import {
  SEMANTIC_QUERY_MAX_ROWS,
  type SemanticFilter,
  type SemanticQuery,
} from '../semantic/semantic-query.ts';
import type { SemanticValue } from '../semantic/semantic-result.ts';
import {
  SemanticRuntimeError,
  type SemanticRuntimeErrorCode,
} from '../semantic/semantic-runtime-error.ts';
import type { SemanticRuntimePort } from '../semantic/semantic-runtime-port.ts';

/**
 * The members of the fixture's model, by the role they play in the battery. The battery knows no
 * data: it checks properties any correct engine has (parts add up to their total, a listed grant
 * sees exactly its values…), so any model with members in these roles can run it.
 */
export interface SemanticContractModel {
  /** An additive measure with exact decimal values: a sum over a decimal column. */
  sum: string;
  /** A count. */
  count: string;
  /** A measure defined as `sum / count`. */
  ratio: string;
  /** A protected string dimension with at least three values, none of them null. */
  dimension: string;
  /** The key of `dimension` in a security context's entitlements. */
  entitlementKey: string;
  /** A coarser string dimension: each value of `dimension` belongs to exactly one of its values. */
  parent: string;
  time: string;
  /** At least three whole months with data, as `YYYY-MM-DD`. */
  dateRange: readonly [string, string];
}

export interface SemanticRuntimePortFixture {
  model: SemanticContractModel;
  openPort(): Promise<SemanticRuntimePort>;
  /** A port whose engine does not answer, for the `unavailable` case. */
  openUnavailablePort(): Promise<SemanticRuntimePort>;
  dispose(): Promise<void>;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/;
/** What an error message must never carry: the engine's words, hosts, addresses, stack frames. */
const ENGINE_WORDS =
  /cube|duckdb|ducklake|postgres|lakehouse|\bsql\b|select |http|\b\d{1,3}(\.\d{1,3}){3}\b|\bat \S+ \(/i;

const IDS = {
  userId: '00000000-0000-4000-8000-00000000c0de',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  workspaceId: '00000000-0000-4000-8000-0000000000b2',
} as const;

/**
 * The battery every SemanticRuntimePort adapter must pass (docs/21 §3.3): metric, filters, security
 * context, time dimension, hierarchy, derived measure, truncation and error normalization.
 */
export function describeSemanticRuntimePortContract(
  adapterName: string,
  fixture: SemanticRuntimePortFixture,
): void {
  describe(`SemanticRuntimePort contract: ${adapterName}`, () => {
    const model = fixture.model;
    const contextWith = (entitlement?: DataEntitlement): SecurityContext => ({
      ...IDS,
      workspaceRole: 'viewer',
      entitlements: entitlement === undefined ? {} : { [model.entitlementKey]: entitlement },
    });
    const everything = contextWith({ kind: 'all' });
    const listed = (first: string, ...rest: string[]) =>
      contextWith({ kind: 'listed', values: [first, ...rest] });
    const noGrant = contextWith();

    let port: SemanticRuntimePort;
    /** Every value of `dimension`, in the engine's ascending order, with its sum and count. */
    let groups: Map<string, { sum: string; count: string }>;
    let values: string[];

    async function counts(
      filters: readonly SemanticFilter[],
      context: SecurityContext = everything,
    ): Promise<Map<string, string>> {
      const result = await port.query(
        {
          measures: [model.count],
          dimensions: [model.dimension],
          filters,
          order: [{ member: model.dimension, direction: 'asc' }],
        },
        context,
      );
      return new Map(result.rows.map((row) => [text(row[0]), text(row[1])]));
    }

    const expectedCounts = (keep: (value: string) => boolean) =>
      new Map(values.filter(keep).map((value) => [value, groups.get(value)?.count ?? 'missing']));

    beforeAll(async () => {
      port = await fixture.openPort();
      const result = await port.query(
        {
          measures: [model.sum, model.count],
          dimensions: [model.dimension],
          order: [{ member: model.dimension, direction: 'asc' }],
        },
        everything,
      );
      groups = new Map(
        result.rows.map((row) => [text(row[0]), { sum: text(row[1]), count: text(row[2]) }]),
      );
      values = [...groups.keys()];
    });

    afterAll(async () => {
      await fixture.dispose();
    });

    it('declares its capabilities as flags', () => {
      for (const flag of [
        'windowFunctions',
        'multiStageCalculations',
        'preAggregations',
        'semanticSql',
      ] as const) {
        expect(typeof port.capabilities[flag], flag).toBe('boolean');
      }
    });

    it('describes the members a context may use, and none without a grant', async () => {
      const described = await port.describe(everything);
      const measures = new Map(described.measures.map((member) => [member.name, member.type]));
      const dimensions = new Map(described.dimensions.map((member) => [member.name, member.type]));

      expect(measures.get(model.sum)).toBe('number');
      expect(measures.get(model.count)).toBe('number');
      expect(measures.get(model.ratio)).toBe('number');
      expect(dimensions.get(model.dimension)).toBe('string');
      expect(dimensions.get(model.parent)).toBe('string');
      expect(dimensions.get(model.time)).toBe('time');
      for (const member of [...described.measures, ...described.dimensions]) {
        expect(member.title.length, member.name).toBeGreaterThan(0);
      }
      expect(await port.describe(noGrant)).toEqual({ measures: [], dimensions: [] });
    });

    it('answers a metric whose total is the exact sum of its groups', async () => {
      const total = await port.query({ measures: [model.sum, model.count] }, everything);

      expect(values.length).toBeGreaterThanOrEqual(3);
      expect(total.columns).toEqual([
        { member: model.sum, kind: 'measure', type: 'number' },
        { member: model.count, kind: 'measure', type: 'number' },
      ]);
      expect(total).toMatchObject({ rowCount: 1, truncated: false });
      const [sum, count] = total.rows[0] ?? [];
      expect(sum).toMatch(DECIMAL);
      expect(normalizeDecimal(text(sum))).toBe(
        sumDecimals([...groups.values()].map((group) => group.sum)),
      );
      expect(count).toBe(sumDecimals([...groups.values()].map((group) => group.count)));
    });

    it('returns positional rows: dimensions, then time, then measures, each in query order', async () => {
      const result = await port.query(
        {
          measures: [model.count, model.sum],
          dimensions: [model.parent, model.dimension],
          timeDimensions: [
            { member: model.time, granularity: 'month', dateRange: model.dateRange },
          ],
          limit: 5,
        },
        everything,
      );

      expect(result.columns).toEqual([
        { member: model.parent, kind: 'dimension', type: 'string' },
        { member: model.dimension, kind: 'dimension', type: 'string' },
        { member: model.time, kind: 'time', type: 'time', granularity: 'month' },
        { member: model.count, kind: 'measure', type: 'number' },
        { member: model.sum, kind: 'measure', type: 'number' },
      ]);
      expect(result.rows).toHaveLength(5);
      for (const row of result.rows) {
        expect(row).toHaveLength(5);
        expect(row[2]).toMatch(TIMESTAMP);
        expect(row[3]).toMatch(DECIMAL);
        expect(row[4]).toMatch(DECIMAL);
      }
    });

    it('filters by equality and membership, combined with AND', async () => {
      const [first, second] = values as [string, string];

      expect(
        await counts([{ member: model.dimension, operator: 'equals', values: [first] }]),
      ).toEqual(expectedCounts((value) => value === first));
      expect(
        await counts([{ member: model.dimension, operator: 'notEquals', values: [first] }]),
      ).toEqual(expectedCounts((value) => value !== first));
      expect(
        await counts([{ member: model.dimension, operator: 'in', values: [first, second] }]),
      ).toEqual(expectedCounts((value) => value === first || value === second));
      expect(
        await counts([{ member: model.dimension, operator: 'notIn', values: [first, second] }]),
      ).toEqual(expectedCounts((value) => value !== first && value !== second));
      expect(
        await counts([
          { member: model.dimension, operator: 'in', values: [first, second] },
          { member: model.dimension, operator: 'notEquals', values: [first] },
        ]),
      ).toEqual(expectedCounts((value) => value === second));
      expect(await counts([{ member: model.dimension, operator: 'isNull', values: [] }])).toEqual(
        new Map(),
      );
    });

    it('filters text ignoring case', async () => {
      const [first] = values as [string];
      const needle = first.slice(1, 3).toUpperCase();
      const prefix = first.slice(0, 1).toLowerCase();

      expect(
        await counts([{ member: model.dimension, operator: 'contains', values: [needle] }]),
      ).toEqual(expectedCounts((value) => value.toLowerCase().includes(needle.toLowerCase())));
      expect(
        await counts([{ member: model.dimension, operator: 'startsWith', values: [prefix] }]),
      ).toEqual(expectedCounts((value) => value.toLowerCase().startsWith(prefix)));
    });

    it('compares a measure, and takes both ends of a range', async () => {
      const monthly = async (filters: readonly SemanticFilter[] = []) => {
        const result = await port.query(
          {
            measures: [model.count],
            timeDimensions: [
              { member: model.time, granularity: 'month', dateRange: model.dateRange },
            ],
            filters,
            order: [{ member: model.time, direction: 'asc' }],
          },
          everything,
        );
        return new Map(result.rows.map((row) => [text(row[0]), BigInt(text(row[1]))]));
      };
      const all = await monthly();
      const sorted = [...new Set(all.values())].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      expect(sorted.length).toBeGreaterThanOrEqual(3);
      const [low, middle] = sorted as [bigint, bigint];
      const keep = (test: (count: bigint) => boolean) =>
        new Map([...all].filter(([, count]) => test(count)));
      const on = (operator: SemanticFilter['operator'], ...bounds: bigint[]) =>
        monthly([{ member: model.count, operator, values: bounds.map(String) }]);

      expect(await on('gt', middle)).toEqual(keep((count) => count > middle));
      expect(await on('gte', middle)).toEqual(keep((count) => count >= middle));
      expect(await on('lt', middle)).toEqual(keep((count) => count < middle));
      expect(await on('lte', middle)).toEqual(keep((count) => count <= middle));
      expect(await on('between', low, middle)).toEqual(
        keep((count) => count >= low && count <= middle),
      );
    });

    it('groups by time: the months of a range add up to the range', async () => {
      const months = await port.query(
        {
          measures: [model.sum],
          timeDimensions: [
            { member: model.time, granularity: 'month', dateRange: model.dateRange },
          ],
          order: [{ member: model.time, direction: 'asc' }],
        },
        everything,
      );
      const range = await port.query(
        {
          measures: [model.sum],
          timeDimensions: [{ member: model.time, dateRange: model.dateRange }],
        },
        everything,
      );
      const between = await port.query(
        {
          measures: [model.sum],
          filters: [{ member: model.time, operator: 'between', values: [...model.dateRange] }],
        },
        everything,
      );

      expect(range.columns).toEqual([{ member: model.sum, kind: 'measure', type: 'number' }]);
      expect(months.rowCount).toBeGreaterThanOrEqual(3);
      const starts = months.rows.map((row) => text(row[0]));
      expect(starts).toEqual([...starts].sort());
      for (const start of starts) {
        expect(start).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000$/);
        expect(start.slice(0, 10) >= model.dateRange[0].slice(0, 8) + '01').toBe(true);
        expect(start.slice(0, 10) <= model.dateRange[1]).toBe(true);
      }
      const rangeTotal = normalizeDecimal(text(range.rows[0]?.[0]));
      expect(sumDecimals(months.rows.map((row) => text(row[1])))).toBe(rangeTotal);
      expect(normalizeDecimal(text(between.rows[0]?.[0]))).toBe(rangeTotal);
    });

    it('rolls a hierarchy up: a parent is the sum of its children', async () => {
      const children = await port.query(
        { measures: [model.sum], dimensions: [model.parent, model.dimension] },
        everything,
      );
      const parents = await port.query(
        { measures: [model.sum], dimensions: [model.parent] },
        everything,
      );

      const byParent = new Map<string, string[]>();
      for (const [parent, , sum] of children.rows) {
        byParent.set(text(parent), [...(byParent.get(text(parent)) ?? []), text(sum)]);
      }
      expect(children.rows.map((row) => text(row[1])).sort()).toEqual([...values].sort());
      expect(
        new Map(parents.rows.map((row) => [text(row[0]), normalizeDecimal(text(row[1]))])),
      ).toEqual(new Map([...byParent].map(([parent, sums]) => [parent, sumDecimals(sums)])));
    });

    it('computes a derived measure from its parts', async () => {
      const result = await port.query(
        { measures: [model.sum, model.count, model.ratio], dimensions: [model.dimension] },
        everything,
      );

      expect(result.rowCount).toBe(values.length);
      // A non-additive result carries the engine's precision, which the port passes on untouched:
      // Cube Store truncates a division answered from a pre-aggregation to six decimals, DuckDB
      // keeps a double (build step 5, phase A). The battery checks the computation, not the digits.
      for (const [value, sum, count, ratio] of result.rows) {
        const expected = Number(text(sum)) / Number(text(count));
        expect(Math.abs(Number(text(ratio)) - expected), text(value)).toBeLessThan(1e-6);
      }
    });

    it('applies the security context: a listed grant sees exactly its values', async () => {
      const [first, second, third] = values as [string, string, string];

      expect(await counts([], listed(first))).toEqual(expectedCounts((value) => value === first));
      expect(await counts([], listed(first, second))).toEqual(
        expectedCounts((value) => value === first || value === second),
      );
      const total = await port.query({ measures: [model.sum] }, listed(first));
      expect(normalizeDecimal(text(total.rows[0]?.[0]))).toBe(
        normalizeDecimal(groups.get(first)?.sum ?? 'missing'),
      );
      // A filter never widens a grant.
      expect(
        await counts(
          [{ member: model.dimension, operator: 'in', values: [first, second, third] }],
          listed(first),
        ),
      ).toEqual(expectedCounts((value) => value === first));
      expect(
        await counts(
          [{ member: model.dimension, operator: 'equals', values: [second] }],
          listed(first),
        ),
      ).toEqual(new Map());
    });

    it('refuses every member to a context without a grant, like a member that does not exist', async () => {
      const denied = await expectSemanticRuntimeError(
        port.query({ measures: [model.sum] }, noGrant),
        'unknown_member',
      );
      const missing = await expectSemanticRuntimeError(
        port.query({ measures: ['contract_missing.nothing'] }, everything),
        'unknown_member',
      );

      expect(denied.message).toBe(missing.message);
    });

    it('orders, limits, and reports truncation', async () => {
      const query = (limit: number, direction: 'asc' | 'desc' = 'asc'): SemanticQuery => ({
        measures: [model.count],
        dimensions: [model.dimension],
        order: [{ member: model.dimension, direction }],
        limit,
      });

      const descending = await port.query(query(SEMANTIC_QUERY_MAX_ROWS, 'desc'), everything);
      const two = await port.query(query(2), everything);
      const exact = await port.query(query(values.length), everything);

      expect(descending.rows.map((row) => row[0])).toEqual([...values].reverse());
      expect(two).toMatchObject({ rowCount: 2, truncated: true });
      expect(two.rows.map((row) => row[0])).toEqual(values.slice(0, 2));
      expect(exact).toMatchObject({ rowCount: values.length, truncated: false });
    });

    it('rejects a malformed query with invalid_query, in its own words', async () => {
      const malformed: readonly [string, unknown][] = [
        ['not an object', null],
        ['no members', { measures: [] }],
        ['a member that is not a name', { measures: ['DROP TABLE x'] }],
        ['an unknown field', { measures: [model.sum], ungrouped: true }],
        ['a duplicated member', { measures: [model.sum, model.sum] }],
        [
          'an unknown operator',
          {
            measures: [model.sum],
            filters: [{ member: model.dimension, operator: 'like', values: ['x'] }],
          },
        ],
        [
          'between with one value',
          {
            measures: [model.sum],
            filters: [{ member: model.count, operator: 'between', values: ['1'] }],
          },
        ],
        [
          'a comparison with a value that is not a number',
          {
            measures: [model.sum],
            filters: [{ member: model.count, operator: 'gt', values: ['many'] }],
          },
        ],
        [
          'a text operator on a measure',
          {
            measures: [model.sum],
            filters: [{ member: model.count, operator: 'contains', values: ['1'] }],
          },
        ],
        [
          'a date that is not a date',
          {
            measures: [model.sum],
            timeDimensions: [{ member: model.time, dateRange: ['2025-13-45', '2025-02-01'] }],
          },
        ],
        [
          'a range that ends before it starts',
          {
            measures: [model.sum],
            timeDimensions: [{ member: model.time, dateRange: ['2025-02-01', '2025-01-01'] }],
          },
        ],
        [
          'a granularity that does not exist',
          {
            measures: [model.sum],
            timeDimensions: [{ member: model.time, granularity: 'fortnight' }],
          },
        ],
        [
          'a time dimension that is not a time',
          {
            measures: [model.sum],
            timeDimensions: [{ member: model.dimension, granularity: 'month' }],
          },
        ],
        [
          'an order on a member the query does not return',
          { measures: [model.sum], order: [{ member: model.dimension, direction: 'asc' }] },
        ],
        ['a limit of zero', { measures: [model.sum], limit: 0 }],
        ['a fractional limit', { measures: [model.sum], limit: 1.5 }],
        [
          'a limit above the maximum',
          { measures: [model.sum], limit: SEMANTIC_QUERY_MAX_ROWS + 1 },
        ],
      ];

      for (const [label, query] of malformed) {
        const error = await expectSemanticRuntimeError(
          port.query(query as SemanticQuery, everything),
          'invalid_query',
          label,
        );
        expect(error.retryable, label).toBe(false);
        expect(error.message, label).not.toMatch(ENGINE_WORDS);
      }
    });

    it('reports an engine that does not answer as unavailable, retryable', async () => {
      const unavailable = await fixture.openUnavailablePort();

      const query = await expectSemanticRuntimeError(
        unavailable.query({ measures: [model.sum] }, everything),
        'unavailable',
      );
      const describing = await expectSemanticRuntimeError(
        unavailable.describe(everything),
        'unavailable',
      );

      for (const error of [query, describing]) {
        expect(error.retryable).toBe(true);
        expect(error.message).not.toMatch(ENGINE_WORDS);
      }
    });
  });
}

export async function expectSemanticRuntimeError(
  operation: Promise<unknown>,
  code: SemanticRuntimeErrorCode,
  context?: string,
): Promise<SemanticRuntimeError> {
  const error: unknown = await operation.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error, context).toBeInstanceOf(SemanticRuntimeError);
  expect((error as SemanticRuntimeError).code, context).toBe(code);
  return error as SemanticRuntimeError;
}

function text(value: SemanticValue | undefined): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected a string value, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** `446207.50` → `446207.5`; `12.00` → `12`. */
export function normalizeDecimal(value: string): string {
  if (!value.includes('.')) {
    return value;
  }
  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

/** Exact sum of decimal strings, normalized — no floating point involved. */
export function sumDecimals(values: readonly string[]): string {
  const scale = Math.max(0, ...values.map((value) => (value.split('.')[1] ?? '').length));
  const scaled = values.reduce((total, value) => {
    const negative = value.startsWith('-');
    const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
    const digits = BigInt(whole + fraction.padEnd(scale, '0'));
    return total + (negative ? -digits : digits);
  }, 0n);
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return normalizeDecimal(`${negative ? '-' : ''}${whole}${scale > 0 ? `.${fraction}` : ''}`);
}
