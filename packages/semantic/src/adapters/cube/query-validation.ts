import {
  FILTER_OPERATORS,
  SEMANTIC_QUERY_MAX_ROWS,
  SORT_DIRECTIONS,
  TIME_GRANULARITIES,
  type FilterOperator,
  type SemanticFilter,
  type SemanticModel,
  type SemanticOrder,
  type SemanticQuery,
  type SemanticTimeDimension,
  type SemanticValueType,
  type TimeGranularity,
} from '@atlasbi/contracts';

import { invalidQuery, unknownMember } from './error-mapping.ts';

/** A query checked against the members its security context may use. */
export interface ResolvedQuery {
  measures: readonly string[];
  dimensions: readonly string[];
  timeDimensions: readonly SemanticTimeDimension[];
  filters: readonly SemanticFilter[];
  order: readonly SemanticOrder[];
  limit: number;
  /** Every member the query mentions, returned or only filtered on. */
  types: ReadonlyMap<string, SemanticValueType>;
}

const MEMBER = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?)?$/;

/** Bounds that keep one query from becoming a denial of service; no dashboard comes near them. */
const MAX_MEMBERS = 50;
const MAX_TIME_DIMENSIONS = 5;
const MAX_FILTERS = 50;
const MAX_VALUES = 1000;
const MAX_VALUE_LENGTH = 1000;
const MAX_ORDER = 10;

const QUERY_FIELDS = ['measures', 'dimensions', 'timeDimensions', 'filters', 'order', 'limit'];

/** How many values each operator takes: exactly, or at least one. */
const VALUE_COUNT: Record<FilterOperator, number | 'some'> = {
  equals: 'some',
  notEquals: 'some',
  in: 'some',
  notIn: 'some',
  gt: 1,
  gte: 1,
  lt: 1,
  lte: 1,
  between: 2,
  contains: 'some',
  startsWith: 'some',
  isNull: 0,
};

const OPERATORS_BY_TYPE: Record<SemanticValueType, readonly FilterOperator[]> = {
  string: ['equals', 'notEquals', 'in', 'notIn', 'contains', 'startsWith', 'isNull'],
  number: ['equals', 'notEquals', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'between', 'isNull'],
  time: ['between', 'isNull'],
  boolean: ['equals', 'notEquals', 'isNull'],
};

/**
 * The shape of a query, checked before anything reaches the engine — the port may be called with
 * anything, and Cube's own answers to malformed queries leak its internals (P5-6).
 */
export function parseSemanticQuery(input: unknown): SemanticQuery {
  const query = record(input, 'a query is an object');
  onlyFields(query, QUERY_FIELDS, 'the query');
  const measures = members(query.measures, 'measures', true);
  const dimensions = members(query.dimensions, 'dimensions', false);
  const timeDimensions = list(query.timeDimensions, 'timeDimensions', MAX_TIME_DIMENSIONS).map(
    parseTimeDimension,
  );
  const filters = list(query.filters, 'filters', MAX_FILTERS).map(parseFilter);
  const order = list(query.order, 'order', MAX_ORDER).map(parseOrder);
  const limit = parseLimit(query.limit);

  const grouped = timeDimensions.flatMap((time) =>
    time.granularity === undefined ? [] : [time.member],
  );
  unique(measures, 'measures');
  unique([...dimensions, ...grouped], 'dimensions');
  if (measures.length + dimensions.length + grouped.length === 0) {
    throw invalidQuery('it asks for no measure and no dimension');
  }
  return {
    measures,
    dimensions,
    timeDimensions,
    filters,
    order,
    ...(limit === undefined ? {} : { limit }),
  };
}

/**
 * Checks every member against what this security context may use (its own model, never another
 * one), and every filter against its member's type. Unknown and forbidden members fail alike.
 */
export function resolveAgainstModel(query: SemanticQuery, model: SemanticModel): ResolvedQuery {
  const measureTypes = new Map(model.measures.map((member) => [member.name, member.type]));
  const dimensionTypes = new Map(model.dimensions.map((member) => [member.name, member.type]));
  const types = new Map<string, SemanticValueType>();
  const typeOf = (member: string, from: ReadonlyMap<string, SemanticValueType>) => {
    const type = from.get(member);
    if (type === undefined) {
      throw unknownMember();
    }
    types.set(member, type);
    return type;
  };
  const measures = query.measures;
  const dimensions = query.dimensions ?? [];
  const timeDimensions = query.timeDimensions ?? [];
  const filters = query.filters ?? [];
  const order = query.order ?? [];

  for (const member of measures) {
    typeOf(member, measureTypes);
  }
  for (const member of dimensions) {
    typeOf(member, dimensionTypes);
  }
  for (const time of timeDimensions) {
    if (typeOf(time.member, dimensionTypes) !== 'time') {
      throw invalidQuery(`${time.member} is not a time dimension`);
    }
  }
  const allMembers = new Map([...dimensionTypes, ...measureTypes]);
  for (const filter of filters) {
    checkFilter(filter, typeOf(filter.member, allMembers));
  }
  const returned = new Set([
    ...measures,
    ...dimensions,
    ...timeDimensions.flatMap((time) => (time.granularity === undefined ? [] : [time.member])),
  ]);
  for (const entry of order) {
    if (!returned.has(entry.member)) {
      throw invalidQuery('the order names a member the query does not return');
    }
  }
  return {
    measures,
    dimensions,
    timeDimensions,
    filters,
    order,
    limit: query.limit ?? SEMANTIC_QUERY_MAX_ROWS,
    types,
  };
}

function checkFilter(filter: SemanticFilter, type: SemanticValueType): void {
  if (!OPERATORS_BY_TYPE[type].includes(filter.operator)) {
    throw invalidQuery(`${filter.operator} does not apply to ${filter.member}`);
  }
  for (const value of filter.values) {
    const valid =
      type === 'number'
        ? DECIMAL.test(value)
        : type === 'time'
          ? isDate(value)
          : type === 'boolean'
            ? value === 'true' || value === 'false'
            : true;
    if (!valid) {
      throw invalidQuery(`a value of the filter on ${filter.member} does not fit its type`);
    }
  }
  if (filter.operator === 'between') {
    const [from = '', to = ''] = filter.values;
    const ordered = type === 'time' ? instant(from) <= instant(to) : Number(from) <= Number(to);
    if (!ordered) {
      throw invalidQuery(`the range of the filter on ${filter.member} ends before it starts`);
    }
  }
}

function parseTimeDimension(input: unknown): SemanticTimeDimension {
  const time = record(input, 'a time dimension is an object');
  onlyFields(time, ['member', 'granularity', 'dateRange'], 'a time dimension');
  const member = memberName(time.member);
  if (time.granularity !== undefined && !isOneOf(time.granularity, TIME_GRANULARITIES)) {
    throw invalidQuery('a granularity is one of ' + TIME_GRANULARITIES.join(', '));
  }
  const granularity: TimeGranularity | undefined = time.granularity;
  let dateRange: [string, string] | undefined;
  if (time.dateRange !== undefined) {
    const range = time.dateRange;
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !range.every((end): end is string => typeof end === 'string' && isDate(end))
    ) {
      throw invalidQuery('a date range is two dates, YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss');
    }
    const [from, to] = range as [string, string];
    if (instant(from) > instant(to)) {
      throw invalidQuery('a date range ends before it starts');
    }
    dateRange = [from, to];
  }
  if (granularity === undefined && dateRange === undefined) {
    throw invalidQuery('a time dimension needs a granularity, a date range, or both');
  }
  return {
    member,
    ...(granularity === undefined ? {} : { granularity }),
    ...(dateRange === undefined ? {} : { dateRange }),
  };
}

function parseFilter(input: unknown): SemanticFilter {
  const filter = record(input, 'a filter is an object');
  onlyFields(filter, ['member', 'operator', 'values'], 'a filter');
  const member = memberName(filter.member);
  if (!isOneOf(filter.operator, FILTER_OPERATORS)) {
    throw invalidQuery('a filter operator is one of ' + FILTER_OPERATORS.join(', '));
  }
  const operator = filter.operator;
  const values = filter.values ?? [];
  if (
    !Array.isArray(values) ||
    values.length > MAX_VALUES ||
    !values.every(
      (value): value is string => typeof value === 'string' && value.length <= MAX_VALUE_LENGTH,
    )
  ) {
    throw invalidQuery(`filter values are at most ${MAX_VALUES} strings`);
  }
  const expected = VALUE_COUNT[operator];
  if (expected === 'some' ? values.length === 0 : values.length !== expected) {
    throw invalidQuery(
      `${operator} takes ${expected === 'some' ? 'at least one value' : `${expected} value(s)`}`,
    );
  }
  return { member, operator, values };
}

function parseOrder(input: unknown): SemanticOrder {
  const entry = record(input, 'an order entry is an object');
  onlyFields(entry, ['member', 'direction'], 'an order entry');
  if (!isOneOf(entry.direction, SORT_DIRECTIONS)) {
    throw invalidQuery('an order direction is asc or desc');
  }
  return { member: memberName(entry.member), direction: entry.direction };
}

function parseLimit(input: unknown): number | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (
    typeof input !== 'number' ||
    !Number.isInteger(input) ||
    input < 1 ||
    input > SEMANTIC_QUERY_MAX_ROWS
  ) {
    throw invalidQuery(`the limit is a whole number from 1 to ${SEMANTIC_QUERY_MAX_ROWS}`);
  }
  return input;
}

function members(input: unknown, field: string, required: boolean): string[] {
  if (input === undefined && !required) {
    return [];
  }
  return list(input, field, MAX_MEMBERS).map(memberName);
}

function list(input: unknown, field: string, max: number): unknown[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input) || input.length > max) {
    throw invalidQuery(`${field} is a list of at most ${max} entries`);
  }
  return input as unknown[];
}

function memberName(input: unknown): string {
  if (typeof input !== 'string' || !MEMBER.test(input)) {
    throw invalidQuery('a member is named <subject>.<member>');
  }
  return input;
}

function unique(names: readonly string[], field: string): void {
  if (new Set(names).size !== names.length) {
    throw invalidQuery(`${field} repeat a member`);
  }
}

function record(input: unknown, reason: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw invalidQuery(reason);
  }
  return input as Record<string, unknown>;
}

function onlyFields(
  input: Record<string, unknown>,
  allowed: readonly string[],
  what: string,
): void {
  const extra = Object.keys(input).find((key) => !allowed.includes(key));
  if (extra !== undefined) {
    throw invalidQuery(`${what} has a field it does not take`);
  }
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

function isDate(value: string): boolean {
  const match = DATE.exec(value);
  if (match === null) {
    return false;
  }
  const [, year, month, day, hours = '0', minutes = '0', seconds = '0'] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day) &&
    Number(hours) <= 23 &&
    Number(minutes) <= 59 &&
    Number(seconds) <= 59
  );
}

function instant(value: string): number {
  return Date.parse(value.length === 10 ? `${value}T00:00:00Z` : `${value}Z`);
}
