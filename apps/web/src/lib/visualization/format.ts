import type { SemanticColumn, SemanticValue, TimeGranularity } from '@atlasbi/contracts';

/** A number as people read it: grouped, with decimals only where they matter. */
export function formatNumber(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  }).format(value);
}

const TIME_FORMATS: Record<Exclude<TimeGranularity, 'quarter'>, Intl.DateTimeFormatOptions> = {
  hour: { dateStyle: 'medium', timeStyle: 'short' },
  day: { dateStyle: 'medium' },
  week: { dateStyle: 'medium' },
  month: { month: 'short', year: 'numeric' },
  year: { year: 'numeric' },
};

/**
 * A category as an axis shows it. Time values come in UTC without a zone (SemanticResult) and are
 * shown in UTC, by the granularity they were truncated to; anything else as it came.
 */
export function formatCategory(
  value: SemanticValue | undefined,
  column: SemanticColumn | undefined,
  locale?: string,
): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'boolean' || column?.kind !== 'time' || column.granularity === undefined) {
    return String(value);
  }
  const date = new Date(`${value}Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  if (column.granularity === 'quarter') {
    return `T${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
  }
  return new Intl.DateTimeFormat(locale, {
    ...TIME_FORMATS[column.granularity],
    timeZone: 'UTC',
  }).format(date);
}
