import type { LogicalType } from '../lakehouse/query-result.ts';

/**
 * Data contracts (docs/21 §2.4): what a layer publishes as a table and another one reads — its
 * columns, their types, which may be null, and the grain. A contract is plain JSON in
 * `packages/contracts/data/`, versioned on its own (`MAJOR.MINOR`), and written in the platform's
 * own type vocabulary (`LogicalType`) — never an engine's, never a tool's.
 */
export const DATA_CONTRACT_KINDS = [
  /** A table the platform reads as its input (a registered source, the development dataset). */
  'source',
  /** What ingestion leaves for transformation: business columns plus the platform's technical ones. */
  'landing',
  /** An analytical result transformation publishes and the semantic layer reads. */
  'mart',
] as const;

export type DataContractKind = (typeof DATA_CONTRACT_KINDS)[number];

/** A contract column is a scalar: nested types wait for a consumer that needs them. */
export type DataContractType = Exclude<LogicalType, { kind: 'list' | 'struct' | 'map' | 'other' }>;

export interface DataContractColumn {
  name: string;
  type: DataContractType;
  /** False is a promise the producer keeps, and its tests check with data. */
  nullable: boolean;
  description?: string;
}

export interface DataContract {
  /** `<kind>.<name>`, e.g. `mart.sales_orders`. */
  id: string;
  /** `MAJOR.MINOR`: a minor version only adds nullable columns; anything else is a new major file. */
  version: string;
  kind: DataContractKind;
  description: string;
  /** Where it is published: schema and table, never the catalog alias of one engine. */
  table: { schema: string; name: string };
  /** The columns that identify a row; never nullable. */
  grain: readonly string[];
  columns: readonly DataContractColumn[];
}

/**
 * Every landing table carries these, written by the ingestion adapter whatever tool extracts the
 * data — a tool's own columns (`_dlt_load_id`…) never reach a contract (layer-isolation audit).
 */
export const LANDING_TECHNICAL_COLUMNS: readonly DataContractColumn[] = [
  {
    name: '_load_id',
    type: { kind: 'varchar' },
    nullable: false,
    description: 'The load that wrote the row; opaque, chosen by the ingestion adapter.',
  },
  {
    name: '_loaded_at',
    type: { kind: 'timestamp_tz' },
    nullable: false,
    description: 'When that load finished.',
  },
];

export class InvalidDataContractError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid data contract:\n- ${issues.join('\n- ')}`);
    this.name = 'InvalidDataContractError';
    this.issues = issues;
  }
}

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const VERSION = /^([1-9]\d*)\.(0|[1-9]\d*)$/;
const CONTRACT_FIELDS = ['id', 'version', 'kind', 'description', 'table', 'grain', 'columns'];
const COLUMN_FIELDS = ['name', 'type', 'nullable', 'description'];
const SIMPLE_KINDS = new Set([
  'boolean',
  'int8',
  'int16',
  'int32',
  'uint8',
  'uint16',
  'uint32',
  'int64',
  'int128',
  'uint64',
  'uint128',
  'float32',
  'float64',
  'varchar',
  'uuid',
  'blob',
  'date',
  'time',
  'timestamp',
  'timestamp_tz',
  'interval',
]);

/** The major version a consumer pins: a contract with another major is another contract. */
export function majorVersion(contract: Pick<DataContract, 'version'>): number {
  return Number(VERSION.exec(contract.version)?.[1] ?? Number.NaN);
}

/** Validates a contract file's content; every problem is listed, none is guessed away. */
export function parseDataContract(value: unknown): DataContract {
  const issues: string[] = [];
  const contract = asRecord(value);
  if (contract === undefined) {
    throw new InvalidDataContractError(['a data contract is a JSON object']);
  }
  unknownFields(contract, CONTRACT_FIELDS, 'the contract', issues);

  const kind = contract.kind;
  if (!DATA_CONTRACT_KINDS.includes(kind as DataContractKind)) {
    issues.push(`kind must be one of ${DATA_CONTRACT_KINDS.join(', ')}`);
  }
  const id = contract.id;
  if (
    typeof id !== 'string' ||
    !/^[a-z]+\.[a-z][a-z0-9_]*$/.test(id) ||
    !id.startsWith(`${String(kind)}.`)
  ) {
    issues.push(`id must be "<kind>.<name>" in lowercase, starting with "${String(kind)}."`);
  }
  if (typeof contract.version !== 'string' || !VERSION.test(contract.version)) {
    issues.push('version must be MAJOR.MINOR, with MAJOR from 1');
  }
  if (typeof contract.description !== 'string' || contract.description.trim() === '') {
    issues.push('description must say what the table holds');
  }
  const table = asRecord(contract.table);
  if (
    table === undefined ||
    !isIdentifier(table.schema) ||
    !isIdentifier(table.name) ||
    Object.keys(table).length !== 2
  ) {
    issues.push('table must be { schema, name }, both lowercase identifiers');
  }

  const columns = Array.isArray(contract.columns) ? contract.columns : [];
  if (columns.length === 0) {
    issues.push('columns must list at least one column');
  }
  const parsedColumns = columns.flatMap((column, index) => {
    const parsed = parseColumn(column, `column ${index + 1}`, issues);
    return parsed === undefined ? [] : [parsed];
  });
  // Every name as written, valid column or not: a duplicate is a problem of its own.
  const names = columns.flatMap((column) => {
    const name = asRecord(column)?.name;
    return typeof name === 'string' ? [name] : [];
  });
  for (const name of new Set(names.filter((name, index) => names.indexOf(name) !== index))) {
    issues.push(`column ${name} appears more than once`);
  }
  for (const column of parsedColumns) {
    // One of the two places outside packages/ingestion that name its tool, on purpose (decision
    // D2, docs/21 §2.4): this guard exists to stop that tool's metadata, so it has to know it. A
    // test in packages/ingestion lists it as a known exception.
    if (/^_dlt/i.test(column.name)) {
      issues.push(`column ${column.name} is a tool's metadata, never part of a contract`);
    } else if (
      column.name.startsWith('_') &&
      !(
        kind === 'landing' &&
        LANDING_TECHNICAL_COLUMNS.some((technical) => technical.name === column.name)
      )
    ) {
      issues.push(`column ${column.name}: only the landing technical columns start with "_"`);
    }
  }
  if (kind === 'landing') {
    for (const technical of LANDING_TECHNICAL_COLUMNS) {
      const column = parsedColumns.find((candidate) => candidate.name === technical.name);
      if (
        column === undefined ||
        column.nullable ||
        JSON.stringify(column.type) !== JSON.stringify(technical.type)
      ) {
        issues.push(
          `a landing contract has ${technical.name} (${technical.type.kind}, not nullable)`,
        );
      }
    }
  }

  const grain = Array.isArray(contract.grain) ? contract.grain : [];
  if (grain.length === 0) {
    issues.push('grain must name the columns that identify a row');
  }
  for (const member of grain) {
    const column = parsedColumns.find((candidate) => candidate.name === member);
    if (column === undefined) {
      issues.push(`grain column ${String(member)} is not a column`);
    } else if (column.nullable) {
      issues.push(`grain column ${column.name} cannot be nullable`);
    }
  }

  if (issues.length > 0) {
    throw new InvalidDataContractError(issues);
  }
  return {
    id: id as string,
    version: contract.version as string,
    kind: kind as DataContractKind,
    description: contract.description as string,
    table: { schema: table?.schema as string, name: table?.name as string },
    grain: grain as string[],
    columns: parsedColumns,
  };
}

function parseColumn(
  value: unknown,
  label: string,
  issues: string[],
): DataContractColumn | undefined {
  const column = asRecord(value);
  if (column === undefined) {
    issues.push(`${label} must be an object`);
    return undefined;
  }
  unknownFields(column, COLUMN_FIELDS, label, issues);
  const name = column.name;
  if (typeof name !== 'string' || !/^_?[a-z][a-z0-9_]*$/.test(name)) {
    issues.push(`${label}: name must be a lowercase identifier`);
    return undefined;
  }
  if (typeof column.nullable !== 'boolean') {
    issues.push(`column ${name}: nullable must be true or false`);
  }
  if (column.description !== undefined && typeof column.description !== 'string') {
    issues.push(`column ${name}: description must be text`);
  }
  const type = parseType(column.type);
  if (type === undefined) {
    issues.push(`column ${name}: type must be a scalar LogicalType, e.g. { "kind": "int64" }`);
    return undefined;
  }
  return {
    name,
    type,
    nullable: column.nullable === true,
    ...(typeof column.description === 'string' ? { description: column.description } : {}),
  };
}

function parseType(value: unknown): DataContractType | undefined {
  const type = asRecord(value);
  const kind = type?.kind;
  if (type === undefined || typeof kind !== 'string') {
    return undefined;
  }
  if (kind === 'decimal') {
    const { precision, scale } = type;
    const valid =
      Object.keys(type).length === 3 &&
      Number.isInteger(precision) &&
      Number.isInteger(scale) &&
      (precision as number) >= 1 &&
      (precision as number) <= 38 &&
      (scale as number) >= 0 &&
      (scale as number) <= (precision as number);
    return valid ? { kind, precision: precision as number, scale: scale as number } : undefined;
  }
  return SIMPLE_KINDS.has(kind) && Object.keys(type).length === 1
    ? ({ kind } as DataContractType)
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isIdentifier(value: unknown): boolean {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function unknownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  issues: string[],
): void {
  for (const field of Object.keys(record)) {
    if (!allowed.includes(field)) {
      issues.push(`${label} has an unknown field "${field}"`);
    }
  }
}
