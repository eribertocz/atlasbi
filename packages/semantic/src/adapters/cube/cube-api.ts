// Cube's REST API, as far as the adapter reads and writes it (Cube 1.7). These types never leave
// src/adapters/cube/ (docs/21 §3.2): the rest of the platform speaks SemanticQuery.

export interface CubeFilter {
  member: string;
  operator: string;
  values?: string[];
}

export interface CubeTimeDimension {
  dimension: string;
  granularity?: string;
  dateRange?: [string, string];
}

export interface CubeQuery {
  measures: string[];
  dimensions: string[];
  timeDimensions: CubeTimeDimension[];
  filters: CubeFilter[];
  /** Pairs keep their order; an object's keys would too, but pairs say so. */
  order?: [string, 'asc' | 'desc'][];
  limit: number;
  timezone: 'UTC';
}

export interface CubeMetaMember {
  name: string;
  title?: string;
  type: string;
  isVisible?: boolean;
  public?: boolean;
}

export interface CubeMetaCube {
  name: string;
  isVisible?: boolean;
  public?: boolean;
  measures?: CubeMetaMember[];
  dimensions?: CubeMetaMember[];
}

export interface CubeMeta {
  cubes?: CubeMetaCube[];
}

/** One row of a `/v1/load` answer, keyed by member (a time dimension: `<member>.<granularity>`). */
export type CubeRecord = Record<string, unknown>;
