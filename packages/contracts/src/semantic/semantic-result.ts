import type { TimeGranularity } from './semantic-query.ts';

/** The type of a member's values, as the semantic model declares it. */
export const SEMANTIC_VALUE_TYPES = ['string', 'number', 'time', 'boolean'] as const;

export type SemanticValueType = (typeof SEMANTIC_VALUE_TYPES)[number];

export interface SemanticMember {
  /** `<subject>.<member>`, the name a query uses. */
  name: string;
  title: string;
  type: SemanticValueType;
}

/** The members one security context may query — nothing it may not (docs/09 §6.1). */
export interface SemanticModel {
  measures: readonly SemanticMember[];
  dimensions: readonly SemanticMember[];
}

export interface SemanticColumn {
  member: string;
  kind: 'dimension' | 'time' | 'measure';
  type: SemanticValueType;
  /** Set on time columns: the granularity their values are truncated to. */
  granularity?: TimeGranularity;
}

/**
 * A value as the engine computed it, never reinterpreted: numbers are strings in plain decimal
 * notation, exactly as the engine returns them (no scale padding — `446207.5`, not `446207.50`;
 * formatting is the frontend's job). Time values are `YYYY-MM-DDTHH:mm:ss.sss` in UTC, without a
 * zone suffix.
 */
export type SemanticValue = string | boolean | null;

export interface SemanticResult {
  /** Dimensions, then time dimensions with a granularity, then measures — each in query order. */
  columns: readonly SemanticColumn[];
  /** Positional: `rows[i][j]` is the value of `columns[j]`. */
  rows: readonly (readonly SemanticValue[])[];
  rowCount: number;
  /** True when the query had more rows than its limit; the extra rows are not returned. */
  truncated: boolean;
}
