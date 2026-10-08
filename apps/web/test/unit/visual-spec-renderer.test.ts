import { InvalidVisualSpecError, parseVisualSpec, type VisualSpec } from '@atlasbi/contracts';
import { describe, expect, it } from 'vitest';

import { toChartData } from '../../src/lib/visualization/chart-data.ts';
import { toEChartsOption } from '../../src/lib/visualization/echarts/chart-option.ts';

const BAR: VisualSpec = {
  version: 1,
  kind: 'bar',
  measures: ['sales_orders.total_amount'],
  dimensions: ['sales_orders.region'],
  encoding: { category: 'sales_orders.region' },
};

// Decision H3 of build step 6, from the renderer's side: whatever the ECharts adapter draws with
// can never become what a report stores.
describe('what the ECharts adapter builds is never a visual spec', () => {
  const option = toEChartsOption(
    'bar',
    toChartData({
      columns: [
        { member: 'sales_orders.region', kind: 'dimension', type: 'string' },
        { member: 'sales_orders.total_amount', kind: 'measure', type: 'number' },
      ],
      rows: [['North', '10']],
      rowCount: 1,
      truncated: false,
    }),
    'North',
  );

  it('rejects the option as a spec', () => {
    expect(() => parseVisualSpec(option)).toThrow(InvalidVisualSpecError);
  });

  it('rejects the option, or any part of it, next to a valid spec', () => {
    expect(() => parseVisualSpec({ ...BAR, option })).toThrow(InvalidVisualSpecError);
    for (const [field, value] of Object.entries(option)) {
      expect(() => parseVisualSpec({ ...BAR, [field]: value }), field).toThrow(
        InvalidVisualSpecError,
      );
      expect(
        () => parseVisualSpec({ ...BAR, encoding: { ...BAR.encoding, [field]: value } }),
        field,
      ).toThrow(InvalidVisualSpecError);
    }
  });

  it('builds the option from the spec’s data at draw time, never the other way round', () => {
    expect(parseVisualSpec(BAR)).toEqual(BAR);
    expect(Object.keys(BAR).sort()).toEqual([
      'dimensions',
      'encoding',
      'kind',
      'measures',
      'version',
    ]);
  });
});
