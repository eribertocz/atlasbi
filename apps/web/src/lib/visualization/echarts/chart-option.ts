import type { EChartsCoreOption } from 'echarts/core';

import type { ChartData, ChartKind } from '../chart-data.ts';
import { formatNumber } from '../format.ts';

/** How strongly the categories outside a selection fade (the source visual of a cross-filter). */
const UNSELECTED_OPACITY = 0.35;

/**
 * The only place that writes ECharts options (docs/22): from the platform's ChartData, never
 * persisted — a report stores what to show, never how ECharts draws it.
 */
export function toEChartsOption(
  kind: ChartKind,
  data: ChartData,
  selected?: string,
  locale?: string,
): EChartsCoreOption {
  const format = (value: unknown) =>
    typeof value === 'number' ? formatNumber(value, locale) : '—';
  return {
    animation: false,
    tooltip: { trigger: 'axis', valueFormatter: format },
    grid: { left: 64, right: 16, top: 24, bottom: 32 },
    xAxis: { type: 'category', data: data.labels },
    yAxis: { type: 'value', axisLabel: { formatter: format } },
    series: data.series.map((series) => ({
      type: kind,
      name: series.name,
      data: series.values.map((value, index) =>
        selected === undefined || data.categories[index] === selected
          ? value
          : { value, itemStyle: { opacity: UNSELECTED_OPACITY } },
      ),
    })),
  };
}
