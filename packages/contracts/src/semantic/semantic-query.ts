/**
 * What the platform asks the semantic layer (docs/21 §3.1): its own language, never an engine's.
 * Members are named `<subject>.<member>` (`sales_orders.total_amount`), as the model publishes them.
 */

/** Granularities a time dimension can be grouped by. */
export const TIME_GRANULARITIES = ['hour', 'day', 'week', 'month', 'quarter', 'year'] as const;

export type TimeGranularity = (typeof TIME_GRANULARITIES)[number];

/**
 * The operators of the Filter AST (docs/14 §1.1). `contains` and `startsWith` ignore case;
 * `between` includes both ends; `isNull` takes no values.
 */
export const FILTER_OPERATORS = [
  'equals',
  'notEquals',
  'in',
  'notIn',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'contains',
  'startsWith',
  'isNull',
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** Rows returned when a query does not set `limit`, and the most it may ask for. */
export const SEMANTIC_QUERY_MAX_ROWS = 10_000;

export interface SemanticFilter {
  member: string;
  operator: FilterOperator;
  /**
   * Always strings, so nothing is lost on the way: numbers in plain decimal notation (`1234.50`),
   * dates as `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:ss`.
   */
  values: readonly string[];
}

export interface SemanticTimeDimension {
  member: string;
  /** Without one, the time dimension only restricts the range and adds no column. */
  granularity?: TimeGranularity;
  /** Both ends included, as `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:ss`. */
  dateRange?: readonly [string, string];
}

export interface SemanticOrder {
  /** One of the members the query returns. */
  member: string;
  direction: SortDirection;
}

export interface SemanticQuery {
  measures: readonly string[];
  dimensions?: readonly string[];
  timeDimensions?: readonly SemanticTimeDimension[];
  /** Combined with AND. */
  filters?: readonly SemanticFilter[];
  order?: readonly SemanticOrder[];
  /** 1 to {@link SEMANTIC_QUERY_MAX_ROWS}; that maximum when left out. */
  limit?: number;
}
