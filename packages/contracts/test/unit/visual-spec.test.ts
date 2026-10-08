import { describe, expect, it } from 'vitest';

import {
  InvalidVisualSpecError,
  parseVisualSpec,
  type VisualSpec,
  visualPositionIssues,
} from '../../src/index.ts';

const BAR: VisualSpec = {
  version: 1,
  kind: 'bar',
  measures: ['sales_orders.total_amount'],
  dimensions: ['sales_orders.region'],
  encoding: { category: 'sales_orders.region' },
};

/** What a renderer's configuration looks like — an ECharts option, as its adapter builds one. */
const ECHARTS_OPTION = {
  grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
  tooltip: { trigger: 'axis' },
  xAxis: { type: 'category', data: ['North', 'South'] },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', name: 'sales_orders.total_amount', data: [1, 2] }],
};

function issuesOf(value: unknown): readonly string[] {
  try {
    parseVisualSpec(value);
  } catch (error) {
    if (error instanceof InvalidVisualSpecError) {
      return error.issues;
    }
    throw error;
  }
  return [];
}

describe('VisualSpec: what a visual shows, in the platform’s own grammar', () => {
  it('accepts a KPI, a bar by a dimension and a line by month', () => {
    const kpi = {
      version: 1,
      kind: 'kpi',
      measures: ['sales_orders.total_amount'],
      dimensions: [],
    };
    const line = {
      version: 1,
      kind: 'line',
      measures: ['sales_orders.total_amount'],
      dimensions: ['sales_orders.order_date'],
      encoding: { category: 'sales_orders.order_date', granularity: 'month' },
    };

    expect(parseVisualSpec(kpi)).toEqual(kpi);
    expect(parseVisualSpec(BAR)).toEqual(BAR);
    expect(parseVisualSpec(line)).toEqual(line);
  });

  describe('never stores a renderer’s configuration (decision H3)', () => {
    it('rejects an ECharts option stored as the spec', () => {
      expect(issuesOf(ECHARTS_OPTION)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('series is not part of the visual grammar'),
          expect.stringContaining('xAxis is not part of the visual grammar'),
        ]),
      );
    });

    it('rejects an ECharts option next to a valid spec, whole or field by field', () => {
      expect(issuesOf({ ...BAR, option: ECHARTS_OPTION })).toEqual([
        expect.stringContaining('option is not part of the visual grammar'),
      ]);
      for (const [field, value] of Object.entries(ECHARTS_OPTION)) {
        expect(issuesOf({ ...BAR, [field]: value })).toEqual([
          expect.stringContaining(`${field} is not part of the visual grammar`),
        ]);
      }
    });

    it('rejects renderer settings inside the encoding', () => {
      const encoding = { ...BAR.encoding, itemStyle: { opacity: 0.35 }, renderer: 'canvas' };

      expect(issuesOf({ ...BAR, encoding })).toEqual([
        expect.stringContaining('itemStyle is not part of the visual grammar'),
        expect.stringContaining('renderer is not part of the visual grammar'),
      ]);
    });

    it('rejects a renderer’s name as the kind of visual', () => {
      expect(issuesOf({ ...BAR, kind: 'echarts' })).toEqual(['kind must be one of kpi, bar, line']);
    });
  });

  it('lists every problem with members, kinds and encodings', () => {
    expect(
      issuesOf({ version: 2, kind: 'bar', measures: ['total', 'total'], dimensions: [] }),
    ).toEqual([
      'version must be 1',
      'measures: "total" is not a member ("<subject>.<member>")',
      'measures: "total" is not a member ("<subject>.<member>")',
      'measures must name at least one measure',
      'a bar visual reads exactly one dimension',
      'encoding must say which dimension is the category: { category }',
    ]);
    expect(
      issuesOf({
        ...BAR,
        measures: ['sales_orders.total_amount', 'sales_orders.total_amount'],
        encoding: { category: 'sales_orders.order_date' },
      }),
    ).toEqual([
      'measures: sales_orders.total_amount appears more than once',
      'encoding.category must be one of the dimensions',
    ]);
    expect(
      issuesOf({ ...BAR, encoding: { category: 'sales_orders.region', granularity: 'minute' } }),
    ).toEqual(['encoding.granularity must be one of hour, day, week, month, quarter, year']);
    expect(issuesOf({ ...BAR, kind: 'kpi' })).toEqual(['a kpi has no dimensions and no encoding']);
    expect(issuesOf(['not', 'an', 'object'])).toEqual(['a visual spec is an object']);
  });

  it('places a visual on whole cells within the twelve columns of a page', () => {
    expect(visualPositionIssues({ x: 0, y: 0, width: 12, height: 3 })).toEqual([]);
    expect(visualPositionIssues({ x: 6, y: -1, width: 7, height: 0.5 })).toEqual([
      'x and y are whole cells from 0',
      'width and height are whole cells from 1',
      'a visual ends within the 12 columns of the page',
    ]);
  });
});
