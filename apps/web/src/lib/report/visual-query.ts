import type { SemanticFilter, SemanticQuery, VisualSpec } from '@atlasbi/contracts';

/**
 * The question a visual asks the semantic layer: its spec, filtered by what is selected elsewhere.
 * A category grouped by time is asked as a time dimension, in time order; any other category is
 * ordered by its first measure, largest first.
 */
export function toSemanticQuery(
  spec: VisualSpec,
  filters: readonly SemanticFilter[],
): SemanticQuery {
  const category = spec.encoding?.category;
  const granularity = spec.encoding?.granularity;
  const filtered = filters.length === 0 ? {} : { filters };
  if (category !== undefined && granularity !== undefined) {
    const dimensions = spec.dimensions.filter((dimension) => dimension !== category);
    return {
      measures: spec.measures,
      ...(dimensions.length === 0 ? {} : { dimensions }),
      timeDimensions: [{ member: category, granularity }],
      order: [{ member: category, direction: 'asc' }],
      ...filtered,
    };
  }
  const [firstMeasure] = spec.measures;
  return {
    measures: spec.measures,
    ...(spec.dimensions.length === 0
      ? {}
      : {
          dimensions: spec.dimensions,
          ...(firstMeasure === undefined
            ? {}
            : { order: [{ member: firstMeasure, direction: 'desc' as const }] }),
        }),
    ...filtered,
  };
}
