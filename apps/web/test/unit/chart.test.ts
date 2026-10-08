import type { SemanticResult } from '@atlasbi/contracts';
import { describe, expect, it } from 'vitest';

import { toChartData } from '../../src/lib/visualization/chart-data.ts';
import { toEChartsOption } from '../../src/lib/visualization/echarts/chart-option.ts';
import { formatCategory, formatNumber } from '../../src/lib/visualization/format.ts';

const RESULT: SemanticResult = {
  columns: [
    { member: 'sales_orders.region', kind: 'dimension', type: 'string' },
    { member: 'sales_orders.total_amount', kind: 'measure', type: 'number' },
  ],
  rows: [
    ['North', '1048798.45'],
    ['South', null],
    [null, '7'],
  ],
  rowCount: 3,
  truncated: false,
};

const BY_MONTH: SemanticResult = {
  columns: [
    { member: 'sales_orders.order_date', kind: 'time', type: 'time', granularity: 'month' },
    { member: 'sales_orders.total_amount', kind: 'measure', type: 'number' },
  ],
  rows: [
    ['2026-01-01T00:00:00.000', '10'],
    ['2026-12-01T00:00:00.000', '20'],
  ],
  rowCount: 2,
  truncated: false,
};

interface DrawnOption {
  xAxis: { data: string[] };
  series: { type: string; name: string; data: unknown[] }[];
}

describe('chart data and the ECharts adapter', () => {
  it('turns a semantic result into categories, their labels and one series per measure', () => {
    const titles = new Map([['sales_orders.total_amount', 'Total Amount']]);

    expect(toChartData(RESULT, { titles })).toEqual({
      categories: ['North', 'South', null],
      labels: ['North', 'South', '—'],
      series: [
        {
          member: 'sales_orders.total_amount',
          name: 'Total Amount',
          values: [1048798.45, null, 7],
        },
      ],
    });
  });

  it('labels time categories by their granularity, in UTC, and keeps their values to filter by', () => {
    const data = toChartData(BY_MONTH, { locale: 'en-US' });

    expect(data.labels).toEqual(['Jan 2026', 'Dec 2026']);
    expect(data.categories).toEqual(['2026-01-01T00:00:00.000', '2026-12-01T00:00:00.000']);
    expect(
      formatCategory('2026-04-01T00:00:00.000', {
        member: 'sales_orders.order_date',
        kind: 'time',
        type: 'time',
        granularity: 'quarter',
      }),
    ).toBe('T2 2026');
  });

  it('draws the selected category and fades the others', () => {
    const option = toEChartsOption('bar', toChartData(RESULT), 'North') as unknown as DrawnOption;

    expect(option.xAxis.data).toEqual(['North', 'South', '—']);
    expect(option.series[0]?.type).toBe('bar');
    expect(option.series[0]?.data).toEqual([
      1048798.45,
      { value: null, itemStyle: { opacity: 0.35 } },
      { value: 7, itemStyle: { opacity: 0.35 } },
    ]);
  });

  it('draws every category alike without a selection', () => {
    const option = toEChartsOption('line', toChartData(RESULT)) as unknown as DrawnOption;

    expect(option.series[0]).toMatchObject({ type: 'line', data: [1048798.45, null, 7] });
  });

  it('formats numbers with decimals only where they matter', () => {
    expect(formatNumber(1048798.45, 'en-US')).toBe('1,048,798');
    expect(formatNumber(7.456, 'en-US')).toBe('7.46');
  });
});
