import { TIME_GRANULARITIES, type TimeGranularity } from '../semantic/semantic-query.ts';

/**
 * What a visual shows (docs/22 §2, docs/19 §8.1), in the platform's own grammar: a kind of visual,
 * the measures and dimensions it reads, and how they map to the visual. Never a renderer's
 * configuration, nor a renderer's name: which renderer draws a visual is decided when it is drawn,
 * so changing renderers never migrates a saved report.
 */
export const VISUAL_SPEC_VERSION = 1;

export const VISUAL_KINDS = ['kpi', 'bar', 'line'] as const;

export type VisualKind = (typeof VISUAL_KINDS)[number];

export interface VisualEncoding {
  /** The dimension along the category axis: one of the spec's `dimensions`. */
  category: string;
  /** Groups the category by time; the category is then a time dimension. */
  granularity?: TimeGranularity;
}

export interface VisualSpec {
  version: typeof VISUAL_SPEC_VERSION;
  kind: VisualKind;
  /** Members as the semantic model publishes them: `<subject>.<member>`. */
  measures: readonly string[];
  dimensions: readonly string[];
  /** Required by every kind with a category axis; a KPI has none. */
  encoding?: VisualEncoding;
}

export class InvalidVisualSpecError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid visual spec:\n- ${issues.join('\n- ')}`);
    this.name = 'InvalidVisualSpecError';
    this.issues = issues;
  }
}

const SPEC_FIELDS = ['version', 'kind', 'measures', 'dimensions', 'encoding'];
const ENCODING_FIELDS = ['category', 'granularity'];
const MEMBER = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/**
 * Validates a stored or submitted spec; every problem is listed. Strict at every level: a field
 * the grammar does not define — an ECharts `series`, a `tooltip`, a renderer's name — is rejected,
 * never kept "for later" (decision H3 of build step 6).
 */
export function parseVisualSpec(value: unknown): VisualSpec {
  const spec = asRecord(value);
  if (spec === undefined) {
    throw new InvalidVisualSpecError(['a visual spec is an object']);
  }
  const issues: string[] = [];
  unknownFields(spec, SPEC_FIELDS, 'the spec', issues);

  if (spec.version !== VISUAL_SPEC_VERSION) {
    issues.push(`version must be ${VISUAL_SPEC_VERSION}`);
  }
  const kind = spec.kind;
  if (!isVisualKind(kind)) {
    issues.push(`kind must be one of ${VISUAL_KINDS.join(', ')}`);
  }
  const measures = members(spec.measures, 'measures', issues);
  const dimensions = members(spec.dimensions, 'dimensions', issues);
  if (measures.length === 0) {
    issues.push('measures must name at least one measure');
  }

  let encoding: VisualEncoding | undefined;
  if (kind === 'kpi') {
    if (measures.length > 1) {
      issues.push('a kpi shows one measure');
    }
    if (dimensions.length > 0 || spec.encoding !== undefined) {
      issues.push('a kpi has no dimensions and no encoding');
    }
  } else if (isVisualKind(kind)) {
    if (dimensions.length !== 1) {
      issues.push(`a ${kind} visual reads exactly one dimension`);
    }
    encoding = parseEncoding(spec.encoding, dimensions, issues);
  }

  if (issues.length > 0) {
    throw new InvalidVisualSpecError(issues);
  }
  return {
    version: VISUAL_SPEC_VERSION,
    kind: kind as VisualKind,
    measures,
    dimensions,
    ...(encoding === undefined ? {} : { encoding }),
  };
}

function isVisualKind(value: unknown): value is VisualKind {
  return VISUAL_KINDS.includes(value as VisualKind);
}

function parseEncoding(
  value: unknown,
  dimensions: readonly string[],
  issues: string[],
): VisualEncoding | undefined {
  const encoding = asRecord(value);
  if (encoding === undefined) {
    issues.push('encoding must say which dimension is the category: { category }');
    return undefined;
  }
  unknownFields(encoding, ENCODING_FIELDS, 'encoding', issues);
  const { category, granularity } = encoding;
  if (typeof category !== 'string' || !dimensions.includes(category)) {
    issues.push('encoding.category must be one of the dimensions');
    return undefined;
  }
  if (granularity === undefined) {
    return { category };
  }
  if (!TIME_GRANULARITIES.includes(granularity as TimeGranularity)) {
    issues.push(`encoding.granularity must be one of ${TIME_GRANULARITIES.join(', ')}`);
    return undefined;
  }
  return { category, granularity: granularity as TimeGranularity };
}

function members(value: unknown, field: string, issues: string[]): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${field} must be a list of members`);
    return [];
  }
  const valid = value.filter((member): member is string => {
    const ok = typeof member === 'string' && MEMBER.test(member);
    if (!ok) {
      issues.push(`${field}: ${JSON.stringify(member)} is not a member ("<subject>.<member>")`);
    }
    return ok;
  });
  for (const member of new Set(valid.filter((member, index) => valid.indexOf(member) !== index))) {
    issues.push(`${field}: ${member} appears more than once`);
  }
  return valid;
}

function unknownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  issues: string[],
): void {
  for (const field of Object.keys(record)) {
    if (!allowed.includes(field)) {
      issues.push(
        `${label}: ${field} is not part of the visual grammar — a visual never stores a renderer's configuration`,
      );
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
