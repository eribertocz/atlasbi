import type { SemanticResult } from '@atlasbi/contracts';

import { formatCategory } from './format.ts';

/** The chart kinds the Viewer draws today; the full grammar is VisualSpec's (docs/22). */
export const CHART_KINDS = ['bar', 'line'] as const;

export type ChartKind = (typeof CHART_KINDS)[number];

export interface ChartSeries {
  /** The measure it shows, as the semantic layer names it. */
  member: string;
  /** What people read for it: the measure's title. */
  name: string;
  values: (number | null)[];
}

/** What a renderer draws: categories along one axis, one series per measure. Never an engine's format. */
export interface ChartData {
  /** The values a selection filters by; null where there is none to filter by. */
  categories: (string | null)[];
  /** What the axis shows for each category. */
  labels: string[];
  series: ChartSeries[];
}

/**
 * The first dimension or time column gives the categories; every measure column becomes a series.
 * Numbers arrive as exact decimal strings (SemanticResult); a chart only needs them as numbers.
 */
export function toChartData(
  result: SemanticResult,
  options: { titles?: ReadonlyMap<string, string>; locale?: string } = {},
): ChartData {
  const categoryIndex = result.columns.findIndex((column) => column.kind !== 'measure');
  const categoryColumn = result.columns[categoryIndex];
  const measures = result.columns.flatMap((column, index) =>
    column.kind === 'measure' ? [{ member: column.member, index }] : [],
  );
  return {
    categories: result.rows.map((row) => {
      const value = row[categoryIndex];
      return value === null || value === undefined ? null : String(value);
    }),
    labels: result.rows.map((row) =>
      formatCategory(row[categoryIndex], categoryColumn, options.locale),
    ),
    series: measures.map(({ member, index }) => ({
      member,
      name: options.titles?.get(member) ?? member,
      values: result.rows.map((row) => {
        const value = row[index];
        return value === null || value === undefined ? null : Number(value);
      }),
    })),
  };
}
