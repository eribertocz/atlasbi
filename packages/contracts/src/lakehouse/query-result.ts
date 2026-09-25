/**
 * Platform-owned description of a result column (docs/21 §3.2) — never an engine type.
 * `other` carries types the platform has no encoding for yet; their values arrive as strings.
 */
export type LogicalType =
  | { kind: 'boolean' }
  | { kind: 'int8' | 'int16' | 'int32' | 'uint8' | 'uint16' | 'uint32' }
  | { kind: 'int64' | 'int128' | 'uint64' | 'uint128' }
  | { kind: 'float32' | 'float64' }
  | { kind: 'decimal'; precision: number; scale: number }
  | { kind: 'varchar' | 'uuid' | 'blob' }
  | { kind: 'date' | 'time' | 'timestamp' | 'timestamp_tz' | 'interval' }
  | { kind: 'list'; element: LogicalType }
  | { kind: 'struct'; fields: readonly StructField[] }
  | { kind: 'map'; key: LogicalType; value: LogicalType }
  | { kind: 'other'; name: string };

export interface StructField {
  name: string;
  type: LogicalType;
}

/**
 * JSON-safe, lossless value encoding (docs/01 §7):
 * - `int64`/`int128`/`uint64`/`uint128` → base-10 string, always; `decimal(p,s)` → string with
 *   exactly `s` decimals; `float*` → number, with `NaN`/`Infinity`/`-Infinity` as strings.
 * - `date` → `2026-09-23`; `time` → `12:34:56.123456`; `timestamp` → `2026-09-23T12:34:56.123456`
 *   (no zone, none assumed); `timestamp_tz` → UTC with `Z`, from the instant.
 * - `interval` → `{ months, days, micros }` with `micros` as a string; `blob` → base64.
 * - `list`/`struct`/`map` follow the same rules recursively; a map is `[{ key, value }]`.
 */
export type QueryValue =
  null | boolean | number | string | readonly QueryValue[] | { readonly [key: string]: QueryValue };

export interface QueryColumn {
  name: string;
  type: LogicalType;
}

/** One result row: `row[i]` is the value of `columns[i]`. Never an object keyed by column name. */
export type QueryRow = readonly QueryValue[];

/**
 * Rows are **positional**: an array per row, aligned with `columns` by index. Not objects keyed by
 * column name — duplicate column names are legal SQL (`SELECT 1 AS a, 2 AS a`) and an object would
 * silently drop one of them.
 */
export interface QueryResult {
  columns: readonly QueryColumn[];
  /** Positional: `rows[r][i]` belongs to `columns[i]`. */
  rows: readonly QueryRow[];
  rowCount: number;
  /** True when the statement produced more rows than `maxRows` and the rest was not read. */
  truncated: boolean;
}

/** Parameters bind positionally (`$1`, `$2`); pass `bigint` and `decimal` values as strings. */
export type QueryParameter = null | boolean | number | string;
