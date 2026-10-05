import type { SemanticFilter, SemanticValueType } from '@atlasbi/contracts';

import type { CubeFilter, CubeQuery } from './cube-api.ts';
import type { ResolvedQuery } from './query-validation.ts';

/**
 * The platform's query in Cube's format (docs/13 §4, docs/21 §3.1). One more row than the limit is
 * asked for, so the result can say whether the query had more.
 */
export function toCubeQuery(query: ResolvedQuery): CubeQuery {
  return {
    measures: [...query.measures],
    dimensions: [...query.dimensions],
    timeDimensions: query.timeDimensions.map((time) => ({
      dimension: time.member,
      ...(time.granularity === undefined ? {} : { granularity: time.granularity }),
      ...(time.dateRange === undefined ? {} : { dateRange: [...time.dateRange] }),
    })),
    filters: query.filters.flatMap((filter) =>
      toCubeFilters(filter, query.types.get(filter.member)),
    ),
    // Without an order, Cube applies its default one: time, then the first measure.
    ...(query.order.length === 0
      ? {}
      : {
          order: query.order.map((entry): [string, 'asc' | 'desc'] => [
            entry.member,
            entry.direction,
          ]),
        }),
    limit: query.limit + 1,
    timezone: 'UTC',
  };
}

/**
 * The Filter AST operators are not Cube's, one to one: an entry may become zero, one or two Cube
 * filters (docs/13 §4). Only operators Cube documents are sent — Cube 1.7 also takes `in`/`notIn`,
 * but undocumented.
 */
export function toCubeFilters(
  filter: SemanticFilter,
  type: SemanticValueType | undefined,
): CubeFilter[] {
  const { member } = filter;
  const values = [...filter.values];
  switch (filter.operator) {
    case 'in':
      return [{ member, operator: 'equals', values }];
    case 'notIn':
      return [{ member, operator: 'notEquals', values }];
    case 'isNull':
      return [{ member, operator: 'notSet' }];
    case 'between': {
      const [from = '', to = ''] = values;
      return type === 'time'
        ? [{ member, operator: 'inDateRange', values: [from, to] }]
        : [
            { member, operator: 'gte', values: [from] },
            { member, operator: 'lte', values: [to] },
          ];
    }
    case 'equals':
    case 'notEquals':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'contains':
    case 'startsWith':
      return [{ member, operator: filter.operator, values }];
  }
}
