import { SEMANTIC_QUERY_MAX_ROWS, type SemanticModel } from '@atlasbi/contracts';
import { expectSemanticRuntimeError } from '@atlasbi/contracts-testing';
import { describe, expect, it } from 'vitest';

import { UNKNOWN_MEMBER_MESSAGE } from '../../src/adapters/cube/error-mapping.ts';
import {
  parseSemanticQuery,
  resolveAgainstModel,
} from '../../src/adapters/cube/query-validation.ts';

const MODEL: SemanticModel = {
  measures: [
    { name: 'sales_orders.total_amount', title: 'Total Amount', type: 'number' },
    { name: 'sales_orders.order_count', title: 'Order Count', type: 'number' },
  ],
  dimensions: [
    { name: 'sales_orders.region', title: 'Region', type: 'string' },
    { name: 'sales_orders.order_date', title: 'Order Date', type: 'time' },
    { name: 'sales_orders.is_returned', title: 'Returned', type: 'boolean' },
  ],
};

const validate = (input: unknown) =>
  Promise.resolve().then(() => resolveAgainstModel(parseSemanticQuery(input), MODEL));

describe('parseSemanticQuery (shape, before anything reaches the engine)', () => {
  it('accepts a full query and keeps only what it knows', () => {
    const query = {
      measures: ['sales_orders.total_amount'],
      dimensions: ['sales_orders.region'],
      timeDimensions: [
        {
          member: 'sales_orders.order_date',
          granularity: 'month',
          dateRange: ['2025-01-01', '2025-03-31T23:59:59'],
        },
      ],
      filters: [{ member: 'sales_orders.region', operator: 'in', values: ['North', 'South'] }],
      order: [{ member: 'sales_orders.region', direction: 'desc' }],
      limit: 10,
    };

    expect(parseSemanticQuery(query)).toEqual(query);
  });

  it('defaults the limit to the maximum', async () => {
    expect((await validate({ measures: ['sales_orders.total_amount'] })).limit).toBe(
      SEMANTIC_QUERY_MAX_ROWS,
    );
  });

  it.each([
    ['an array', []],
    ['a string', 'SELECT 1'],
    ['measures that are not a list', { measures: 'sales_orders.total_amount' }],
    [
      'more than 50 measures',
      { measures: Array.from({ length: 51 }, (entry, index) => `a.m${index}`) },
    ],
    ['a member without its subject', { measures: ['total_amount'] }],
    ['a member with a quote', { measures: ["sales_orders.x'--"] }],
    [
      'a nested field it does not take',
      {
        measures: ['a.b'],
        filters: [{ member: 'a.b', operator: 'equals', values: ['1'], extra: 1 }],
      },
    ],
    [
      'a filter value that is not a string',
      { measures: ['a.b'], filters: [{ member: 'a.c', operator: 'equals', values: [1] }] },
    ],
    [
      'isNull with a value',
      { measures: ['a.b'], filters: [{ member: 'a.c', operator: 'isNull', values: ['x'] }] },
    ],
    [
      'equals without values',
      { measures: ['a.b'], filters: [{ member: 'a.c', operator: 'equals', values: [] }] },
    ],
    [
      'an order direction that does not exist',
      { measures: ['a.b'], order: [{ member: 'a.b', direction: 'up' }] },
    ],
    [
      'a time dimension with neither granularity nor range',
      { measures: ['a.b'], timeDimensions: [{ member: 'a.t' }] },
    ],
    [
      'February 30th',
      {
        measures: ['a.b'],
        timeDimensions: [{ member: 'a.t', dateRange: ['2025-02-30', '2025-03-01'] }],
      },
    ],
    [
      'a time of 24:00',
      {
        measures: ['a.b'],
        timeDimensions: [{ member: 'a.t', dateRange: ['2025-01-01T24:00:00', '2025-03-01'] }],
      },
    ],
    [
      'a date with a zone',
      {
        measures: ['a.b'],
        timeDimensions: [{ member: 'a.t', dateRange: ['2025-01-01T00:00:00Z', '2025-03-01'] }],
      },
    ],
    [
      'a dimension twice, once as time',
      {
        measures: [],
        dimensions: ['a.t'],
        timeDimensions: [{ member: 'a.t', granularity: 'day' }],
      },
    ],
  ])('rejects %s with invalid_query', async (label, input) => {
    await expectSemanticRuntimeError(validate(input), 'invalid_query', label);
  });

  it('accepts a query of dimensions only, or of a grouped time only', async () => {
    await expect(
      validate({ measures: [], dimensions: ['sales_orders.region'] }),
    ).resolves.toBeDefined();
    await expect(
      validate({
        measures: [],
        timeDimensions: [{ member: 'sales_orders.order_date', granularity: 'year' }],
      }),
    ).resolves.toBeDefined();
  });
});

describe('resolveAgainstModel (the members this security context may use)', () => {
  it('fails an unknown member and a hidden one alike, anywhere in the query', async () => {
    const cases = [
      { measures: ['sales_orders.secret_margin'] },
      { measures: [], dimensions: ['customers.email'] },
      {
        measures: ['sales_orders.total_amount'],
        filters: [{ member: 'customers.email', operator: 'equals', values: ['a@b.c'] }],
      },
      {
        measures: ['sales_orders.total_amount'],
        timeDimensions: [{ member: 'orders.shipped_at', granularity: 'day' }],
      },
    ];

    for (const query of cases) {
      const error = await expectSemanticRuntimeError(validate(query), 'unknown_member');
      expect(error.message).toBe(UNKNOWN_MEMBER_MESSAGE);
    }
    const empty: SemanticModel = { measures: [], dimensions: [] };
    await expectSemanticRuntimeError(
      Promise.resolve().then(() =>
        resolveAgainstModel(parseSemanticQuery({ measures: ['sales_orders.total_amount'] }), empty),
      ),
      'unknown_member',
    );
  });

  it('records the type of every member the query mentions', async () => {
    const query = await validate({
      measures: ['sales_orders.total_amount'],
      filters: [
        { member: 'sales_orders.region', operator: 'equals', values: ['North'] },
        {
          member: 'sales_orders.order_date',
          operator: 'between',
          values: ['2025-01-01', '2025-01-31'],
        },
      ],
    });

    expect(Object.fromEntries(query.types)).toEqual({
      'sales_orders.total_amount': 'number',
      'sales_orders.region': 'string',
      'sales_orders.order_date': 'time',
    });
  });

  it.each([
    [
      'a text operator on a number',
      { member: 'sales_orders.total_amount', operator: 'contains', values: ['1'] },
    ],
    ['a comparison on a string', { member: 'sales_orders.region', operator: 'gt', values: ['N'] }],
    [
      'equals on a time',
      { member: 'sales_orders.order_date', operator: 'equals', values: ['2025-01-01'] },
    ],
    [
      'a number that is not one',
      { member: 'sales_orders.total_amount', operator: 'gt', values: ['1e5'] },
    ],
    [
      'a number with a comma',
      { member: 'sales_orders.total_amount', operator: 'gt', values: ['1,5'] },
    ],
    [
      'a boolean that is not one',
      { member: 'sales_orders.is_returned', operator: 'equals', values: ['yes'] },
    ],
    [
      'a date that is not one',
      { member: 'sales_orders.order_date', operator: 'between', values: ['2025-01-01', 'soon'] },
    ],
    [
      'a numeric range upside down',
      { member: 'sales_orders.total_amount', operator: 'between', values: ['20', '10'] },
    ],
    [
      'a time range upside down',
      {
        member: 'sales_orders.order_date',
        operator: 'between',
        values: ['2025-02-01', '2025-01-01'],
      },
    ],
  ])('rejects %s with invalid_query', async (label, filter) => {
    await expectSemanticRuntimeError(
      validate({ measures: ['sales_orders.total_amount'], filters: [filter] }),
      'invalid_query',
      label,
    );
  });

  it('rejects a time dimension that is not a time, and an order on a member not returned', async () => {
    await expectSemanticRuntimeError(
      validate({
        measures: ['sales_orders.total_amount'],
        timeDimensions: [{ member: 'sales_orders.region', granularity: 'day' }],
      }),
      'invalid_query',
    );
    await expectSemanticRuntimeError(
      validate({
        measures: ['sales_orders.total_amount'],
        order: [{ member: 'sales_orders.region', direction: 'asc' }],
      }),
      'invalid_query',
    );
    await expectSemanticRuntimeError(
      validate({
        measures: ['sales_orders.total_amount'],
        timeDimensions: [
          { member: 'sales_orders.order_date', dateRange: ['2025-01-01', '2025-01-31'] },
        ],
        order: [{ member: 'sales_orders.order_date', direction: 'asc' }],
      }),
      'invalid_query',
    );
  });
});
