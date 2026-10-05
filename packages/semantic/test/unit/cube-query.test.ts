import type { SemanticValueType } from '@atlasbi/contracts';
import { describe, expect, it } from 'vitest';

import { toCubeFilters, toCubeQuery } from '../../src/adapters/cube/cube-query.ts';
import type { ResolvedQuery } from '../../src/adapters/cube/query-validation.ts';

function resolved(overrides: Partial<ResolvedQuery> = {}): ResolvedQuery {
  return {
    measures: ['sales_orders.total_amount'],
    dimensions: [],
    timeDimensions: [],
    filters: [],
    order: [],
    limit: 100,
    types: new Map<string, SemanticValueType>([
      ['sales_orders.total_amount', 'number'],
      ['sales_orders.region', 'string'],
      ['sales_orders.order_date', 'time'],
    ]),
    ...overrides,
  };
}

describe('toCubeQuery (SemanticQuery → Cube, docs/13 §4)', () => {
  it('asks for one row more than the limit, in UTC, with the order as pairs', () => {
    expect(
      toCubeQuery(
        resolved({
          dimensions: ['sales_orders.region'],
          timeDimensions: [
            {
              member: 'sales_orders.order_date',
              granularity: 'month',
              dateRange: ['2025-01-01', '2025-03-31'],
            },
          ],
          order: [
            { member: 'sales_orders.order_date', direction: 'asc' },
            { member: 'sales_orders.total_amount', direction: 'desc' },
          ],
        }),
      ),
    ).toEqual({
      measures: ['sales_orders.total_amount'],
      dimensions: ['sales_orders.region'],
      timeDimensions: [
        {
          dimension: 'sales_orders.order_date',
          granularity: 'month',
          dateRange: ['2025-01-01', '2025-03-31'],
        },
      ],
      filters: [],
      order: [
        ['sales_orders.order_date', 'asc'],
        ['sales_orders.total_amount', 'desc'],
      ],
      limit: 101,
      timezone: 'UTC',
    });
  });

  it("leaves the order out when the query has none, so Cube's default applies", () => {
    expect(toCubeQuery(resolved())).not.toHaveProperty('order');
  });

  it('keeps a time dimension without granularity as a range only', () => {
    expect(
      toCubeQuery(
        resolved({
          timeDimensions: [
            { member: 'sales_orders.order_date', dateRange: ['2025-01-01', '2025-01-31'] },
          ],
        }),
      ).timeDimensions,
    ).toEqual([{ dimension: 'sales_orders.order_date', dateRange: ['2025-01-01', '2025-01-31'] }]);
  });
});

describe('toCubeFilters (Filter AST → Cube operators, not one to one)', () => {
  const region = 'sales_orders.region';

  it.each([
    ['equals', ['North'], [{ member: region, operator: 'equals', values: ['North'] }]],
    ['notEquals', ['North'], [{ member: region, operator: 'notEquals', values: ['North'] }]],
    [
      'in',
      ['North', 'South'],
      [{ member: region, operator: 'equals', values: ['North', 'South'] }],
    ],
    ['notIn', ['North'], [{ member: region, operator: 'notEquals', values: ['North'] }]],
    ['contains', ['or'], [{ member: region, operator: 'contains', values: ['or'] }]],
    ['startsWith', ['N'], [{ member: region, operator: 'startsWith', values: ['N'] }]],
    ['isNull', [], [{ member: region, operator: 'notSet' }]],
  ] as const)('%s', (operator, values, expected) => {
    expect(toCubeFilters({ member: region, operator, values }, 'string')).toEqual(expected);
  });

  it('turns between on a number into gte and lte', () => {
    expect(
      toCubeFilters(
        { member: 'sales_orders.total_amount', operator: 'between', values: ['10', '20.5'] },
        'number',
      ),
    ).toEqual([
      { member: 'sales_orders.total_amount', operator: 'gte', values: ['10'] },
      { member: 'sales_orders.total_amount', operator: 'lte', values: ['20.5'] },
    ]);
  });

  it('turns between on a time into inDateRange', () => {
    expect(
      toCubeFilters(
        {
          member: 'sales_orders.order_date',
          operator: 'between',
          values: ['2025-01-01', '2025-01-31'],
        },
        'time',
      ),
    ).toEqual([
      {
        member: 'sales_orders.order_date',
        operator: 'inDateRange',
        values: ['2025-01-01', '2025-01-31'],
      },
    ]);
  });

  it.each(['gt', 'gte', 'lt', 'lte'] as const)('keeps %s as is', (operator) => {
    expect(
      toCubeFilters({ member: 'sales_orders.total_amount', operator, values: ['5'] }, 'number'),
    ).toEqual([{ member: 'sales_orders.total_amount', operator, values: ['5'] }]);
  });
});
