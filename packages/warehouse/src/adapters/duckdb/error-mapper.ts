import { LakehouseError, type LakehouseErrorCode } from '@atlasbi/contracts';

export const SINGLE_WRITER_REMEDY =
  'SQLite catalogs support a single writing process — restart this process, or use the PostgreSQL catalog (docs/01 §6.6).';
export const PROVISION_REMEDY = 'Provision the lakehouse first: run `pnpm bootstrap`.';
const EXTENSION_REMEDY =
  'Run `pnpm bootstrap` once (needs Internet): it installs the DuckDB extensions. The runtime never downloads them.';

const CREDENTIAL_PATTERNS: readonly (readonly [RegExp, string])[] = [
  // scheme://user:password@host
  [/(\/\/[^:/@\s]+:)[^@\s]*@/g, '$1***@'],
  // libpq keyword form: password=secret
  [/(password\s*=\s*)('[^']*'|"[^"]*"|[^\s"';]+)/gi, '$1***'],
  // DuckDB secret syntax: PASSWORD 'secret'
  [/(PASSWORD\s+)'(?:[^']|'')*'/gi, "$1'***'"],
];

/** Defense in depth: no message leaving the adapter carries a credential, whatever produced it. */
export function redactCredentials(text: string): string {
  return CREDENTIAL_PATTERNS.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    text,
  );
}

interface Rule {
  matches: RegExp;
  code: LakehouseErrorCode;
  retryable?: boolean;
  describe: (message: string) => string;
  remedy?: string;
}

// Built from the verbatim engine messages captured in Phase 0 (S3, S4, S7); order matters —
// the first matching rule wins.
const RULES: readonly Rule[] = [
  {
    matches: /Extension "[^"]*" not found|Install it first/,
    code: 'extension_missing',
    describe: (message) => {
      const name = /Extension "([a-z_]+)" is an existing extension/.exec(message)?.[1];
      return `The DuckDB extension ${name === undefined ? '' : `"${name}" `}is not installed.`;
    },
    remedy: EXTENSION_REMEDY,
  },
  {
    matches: /password authentication failed/,
    code: 'catalog_unreachable',
    describe: (message) => `Cannot connect to the lakehouse catalog: ${fatalDetail(message)}.`,
    remedy: 'Check the credentials in the lakehouse.catalog-url secret.',
  },
  {
    matches: /FATAL:\s+database "[^"]*" does not exist/,
    code: 'catalog_unreachable',
    describe: (message) => `The lakehouse catalog database is missing: ${fatalDetail(message)}.`,
    remedy: PROVISION_REMEDY,
  },
  {
    matches: /creating a new DuckLake is explicitly disabled/,
    code: 'catalog_unreachable',
    describe: () => 'No lakehouse has been provisioned in this catalog yet.',
    remedy: PROVISION_REMEDY,
  },
  {
    matches: /Connection refused|could not connect to server|timeout expired/i,
    code: 'catalog_unreachable',
    retryable: true,
    describe: () => 'Cannot connect to the lakehouse catalog: the server refused the connection.',
    remedy: 'Start the local stack with `pnpm dev`, or check the host and port of the catalog.',
  },
  {
    matches: /DATA_PATH parameter .* does not match existing data path/s,
    code: 'data_path_mismatch',
    describe: (message) => {
      const recorded = /existing data path in the catalog "([^"]*)"/.exec(message)?.[1];
      return `The configured data path is not the one this lakehouse recorded${recorded === undefined ? '' : ` (${recorded})`}.`;
    },
    remedy:
      'Point the data path back to the recorded folder. Reading a moved or copied lakehouse is an explicit option (overrideDataPath), never a default (docs/01 §6.7).',
  },
  {
    matches: /DuckLake catalog version mismatch/,
    code: 'catalog_format_mismatch',
    describe: (message) => {
      const versions =
        /catalog version is (\S+), but the extension requires version (\d+(?:\.\d+)*)/.exec(
          message,
        );
      return versions === null
        ? 'The lakehouse catalog format is not the one this platform supports.'
        : `The lakehouse catalog format is ${versions[1]}; this platform reads and writes ${versions[2]}.`;
    },
    remedy:
      'Changing the catalog format is an explicit administrative migration, never automatic (docs/01 §6.7).',
  },
  {
    matches: /Transaction conflict/,
    code: 'write_conflict',
    describe: (message) =>
      `Another writer changed the same objects first: ${/Transaction conflict - (.*)/.exec(message)?.[1] ?? 'transaction conflict'}.`,
  },
  {
    matches: /database is locked/,
    code: 'catalog_busy',
    retryable: true,
    describe: () => 'The SQLite lakehouse catalog is locked by another writer.',
    remedy: SINGLE_WRITER_REMEDY,
  },
  {
    matches: /read-only mode|configuration has been locked|Permission Error/,
    code: 'read_only_violation',
    describe: (message) => `Not allowed on a read-only lakehouse connection: ${firstLine(message)}`,
  },
  {
    matches: /connection disconnected|database has been closed/i,
    code: 'engine_closed',
    describe: () => 'The lakehouse engine is closed.',
  },
];

/** Normalizes anything thrown inside the adapter into the port's only error type. */
export function toLakehouseError(error: unknown): LakehouseError {
  if (error instanceof LakehouseError) {
    return error;
  }
  const message = redactCredentials(error instanceof Error ? error.message : String(error));
  const rule = RULES.find((candidate) => candidate.matches.test(message));
  if (rule === undefined) {
    return new LakehouseError('query_failed', message.trim());
  }
  return new LakehouseError(rule.code, rule.describe(message), {
    retryable: rule.retryable ?? false,
    ...(rule.remedy === undefined ? {} : { remedy: rule.remedy }),
  });
}

function fatalDetail(message: string): string {
  return (/FATAL:\s+([^\n]*)/.exec(message)?.[1] ?? firstLine(message)).trim();
}

function firstLine(message: string): string {
  return (message.split('\n')[0] ?? '').trim();
}
