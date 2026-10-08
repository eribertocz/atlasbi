import type { SemanticFilter, VisualSpec } from '@atlasbi/contracts';
import { describe, expect, it } from 'vitest';

import { toSemanticQuery } from '../../src/lib/report/visual-query.ts';

const NORTH: SemanticFilter = {
  member: 'sales_orders.region',
  operator: 'equals',
  values: ['North'],
};

describe('the question a visual asks', () => {
  it('asks a KPI for its measure, filtered by what is selected elsewhere', () => {
    const kpi: VisualSpec = {
      version: 1,
      kind: 'kpi',
      measures: ['sales_orders.total_amount'],
      dimensions: [],
    };

    expect(toSemanticQuery(kpi, [])).toEqual({ measures: ['sales_orders.total_amount'] });
    expect(toSemanticQuery(kpi, [NORTH])).toEqual({
      measures: ['sales_orders.total_amount'],
      filters: [NORTH],
    });
  });

  it('asks a bar by its category, largest first', () => {
    const bar: VisualSpec = {
      version: 1,
      kind: 'bar',
      measures: ['sales_orders.total_amount'],
      dimensions: ['sales_orders.region'],
      encoding: { category: 'sales_orders.region' },
    };

    expect(toSemanticQuery(bar, [])).toEqual({
      measures: ['sales_orders.total_amount'],
      dimensions: ['sales_orders.region'],
      order: [{ member: 'sales_orders.total_amount', direction: 'desc' }],
    });
  });

  it('asks a category grouped by time as a time dimension, in time order', () => {
    const line: VisualSpec = {
      version: 1,
      kind: 'line',
      measures: ['sales_orders.total_amount'],
      dimensions: ['sales_orders.order_date'],
      encoding: { category: 'sales_orders.order_date', granularity: 'month' },
    };

    expect(toSemanticQuery(line, [NORTH])).toEqual({
      measures: ['sales_orders.total_amount'],
      timeDimensions: [{ member: 'sales_orders.order_date', granularity: 'month' }],
      order: [{ member: 'sales_orders.order_date', direction: 'asc' }],
      filters: [NORTH],
    });
  });
});
