import {
  SEMANTIC_VALUE_TYPES,
  type SemanticColumn,
  type SemanticMember,
  type SemanticModel,
  type SemanticResult,
  type SemanticValue,
  type SemanticValueType,
} from '@atlasbi/contracts';

import type { CubeMeta, CubeMetaMember, CubeRecord } from './cube-api.ts';
import type { ResolvedQuery } from './query-validation.ts';

/**
 * What a security context may query, from Cube's metadata for that context. Cube already drops
 * whatever the context's access policies hide; members that are not public are dropped here too —
 * never trusted as a security boundary (P5-6), only as "not part of the model's surface".
 * `?extended=true` is never asked for: it carries the model's SQL, tables and files (P5-5).
 */
export function toSemanticModel(meta: CubeMeta): SemanticModel {
  const measures: SemanticMember[] = [];
  const dimensions: SemanticMember[] = [];
  for (const cube of meta.cubes ?? []) {
    if (!isVisible(cube)) {
      continue;
    }
    measures.push(...(cube.measures ?? []).filter(isVisible).map(toMember));
    dimensions.push(...(cube.dimensions ?? []).filter(isVisible).map(toMember));
  }
  return { measures, dimensions };
}

/** Cube's rows, keyed by member, as positional rows in the port's column order. */
export function toSemanticResult(
  query: ResolvedQuery,
  records: readonly CubeRecord[],
): SemanticResult {
  const columns: SemanticColumn[] = [
    ...query.dimensions.map((member): SemanticColumn => ({
      member,
      kind: 'dimension',
      type: typeOf(query, member),
    })),
    ...query.timeDimensions.flatMap((time): SemanticColumn[] =>
      time.granularity === undefined
        ? []
        : [{ member: time.member, kind: 'time', type: 'time', granularity: time.granularity }],
    ),
    ...query.measures.map((member): SemanticColumn => ({
      member,
      kind: 'measure',
      type: typeOf(query, member),
    })),
  ];
  const keys = columns.map((column) =>
    column.granularity === undefined ? column.member : `${column.member}.${column.granularity}`,
  );
  const rows = records
    .slice(0, query.limit)
    .map((record) => keys.map((key, index) => toValue(record[key], columns[index]?.type)));
  return { columns, rows, rowCount: rows.length, truncated: records.length > query.limit };
}

function toValue(raw: unknown, type: SemanticValueType | undefined): SemanticValue {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (type === 'boolean' && (typeof raw === 'boolean' || raw === 'true' || raw === 'false')) {
    return raw === true || raw === 'true';
  }
  // Cube answers numbers as strings already (exact); anything else is kept as its text.
  if (typeof raw === 'string') {
    return raw;
  }
  return typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : JSON.stringify(raw);
}

function typeOf(query: ResolvedQuery, member: string): SemanticValueType {
  return query.types.get(member) ?? 'string';
}

function toMember(member: CubeMetaMember): SemanticMember {
  return {
    name: member.name,
    title: member.title ?? member.name,
    type: (SEMANTIC_VALUE_TYPES as readonly string[]).includes(member.type)
      ? (member.type as SemanticValueType)
      : 'string',
  };
}

function isVisible(item: { isVisible?: boolean; public?: boolean }): boolean {
  return item.isVisible !== false && item.public !== false;
}
