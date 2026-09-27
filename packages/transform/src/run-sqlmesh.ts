import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createLakehouseAdmin,
  resolveLakehouseLocation,
  type LakehouseSettings,
} from '@atlasbi/warehouse';

/** Folder of the uv project (pyproject.toml, uv.lock, .venv). */
export const TRANSFORM_PACKAGE_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
/** The SQLMesh project itself: config.py, models/, tests/, linter/. */
export const SQLMESH_PROJECT_DIRECTORY = path.join(TRANSFORM_PACKAGE_DIRECTORY, 'project');

export type TransformTarget =
  | { mode: 'lakehouse'; lakehouse: LakehouseSettings; stateConnectionString: string }
  /** SQLMesh unit tests and linting: in-memory DuckDB, no lakehouse, no secrets. */
  | { mode: 'unit-tests'; extensionDirectory: string };

export interface RunSqlMeshOptions {
  /** A copy of the project (tests); defaults to SQLMESH_PROJECT_DIRECTORY. */
  projectDirectory?: string;
  /** `terminal` streams SQLMesh's own output live; `capture` collects it (tests, automation). */
  output?: 'terminal' | 'capture';
  /** Show Python tracebacks in full instead of their last line. */
  debug?: boolean;
}

export interface SqlMeshRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** One line explaining a failure, credentials removed; undefined on success. */
  failure: string | undefined;
}

const forwardSlashes = (value: string) => value.replaceAll('\\', '/');

/**
 * The only supported way to run SQLMesh (docs/02 §6.1.2). Before SQLMesh attaches the lakehouse,
 * the platform opens it with CREATE_IF_NOT_EXISTS false: SQLMesh's own ATTACH would silently create
 * an empty lakehouse on a wrong catalog (Phase 0 of build step 2). Secrets reach the SQLMesh process
 * only, through its environment — never the parent's, never a file.
 */
export async function runSqlMesh(
  target: TransformTarget,
  args: readonly string[],
  options: RunSqlMeshOptions = {},
): Promise<SqlMeshRun> {
  const stateSchema =
    target.mode === 'lakehouse'
      ? stateSchemaFor(await provisionedLakehouseId(target.lakehouse))
      : undefined;
  const projectDirectory = options.projectDirectory ?? SQLMESH_PROJECT_DIRECTORY;
  const capture = options.output === 'capture';
  return new Promise((resolve, reject) => {
    const child = spawn(
      'uv',
      ['run', '--frozen', '--offline', 'sqlmesh', '-p', projectDirectory, ...args],
      {
        cwd: TRANSFORM_PACKAGE_DIRECTORY,
        env: childEnvironment(target, stateSchema),
        // stdout is never redirected to a null device: on Windows SQLMesh then exits 1 silently.
        stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['inherit', 'inherit', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.once('error', (error: NodeJS.ErrnoException) =>
      reject(
        error.code === 'ENOENT'
          ? new Error('`uv` was not found on PATH — install it (see `pnpm preflight`).')
          : error,
      ),
    );
    child.once('close', (code) => {
      const exitCode = code ?? 1;
      const failure = exitCode === 0 ? undefined : describeFailure(stderr || stdout);
      // At a terminal, warnings pass through as they are; a failure is reported by the caller as
      // one line (`failure`), with the full trace only on request.
      const showStderr = !capture && stderr !== '' && (exitCode === 0 || options.debug === true);
      if (showStderr) {
        process.stderr.write(stderr);
      }
      resolve({ exitCode, stdout, stderr, failure });
    });
  });
}

/** Opens the lakehouse the platform's way (never creating it) and returns its identity. */
async function provisionedLakehouseId(settings: LakehouseSettings): Promise<string> {
  const admin = await createLakehouseAdmin(settings);
  try {
    return (await admin.checkHealth()).lakehouseId;
  } finally {
    await admin.close();
  }
}

/**
 * One SQLMesh state per lakehouse (docs/02 §6.3): a shared state would tell SQLMesh that models
 * exist in a lakehouse that never built them. The identity changes whenever a lakehouse is
 * created again, so a new lakehouse always starts from an empty state.
 */
export function stateSchemaFor(lakehouseId: string): string {
  return `sqlmesh_${lakehouseId.replaceAll('-', '').toLowerCase()}`;
}

/** Only what SQLMesh needs: every other ATLASBI_* variable — other secrets included — stays out. */
function childEnvironment(
  target: TransformTarget,
  stateSchema: string | undefined,
): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('ATLASBI_')),
  );
  const shared = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  if (target.mode === 'unit-tests') {
    return {
      ...inherited,
      ...shared,
      ATLASBI_TRANSFORM_MODE: 'unit-tests',
      ATLASBI_DUCKDB_EXTENSION_DIRECTORY: forwardSlashes(path.resolve(target.extensionDirectory)),
    };
  }
  const location = resolveLakehouseLocation(target.lakehouse);
  const { catalog, storage } = target.lakehouse;
  return {
    ...inherited,
    ...shared,
    ATLASBI_TRANSFORM_MODE: 'lakehouse',
    ATLASBI_DUCKDB_EXTENSION_DIRECTORY: location.extensionDirectory,
    ATLASBI_LAKEHOUSE_CATALOG_TYPE: catalog.type,
    // The exact spelling the catalog recorded; anything else is a data path mismatch.
    ATLASBI_LAKEHOUSE_DATA_PATH: location.dataPath,
    ...(catalog.type === 'postgres'
      ? { ATLASBI_LAKEHOUSE_CATALOG_URL: catalog.connectionString }
      : { ATLASBI_LAKEHOUSE_SQLITE_PATH: location.sqliteCatalogPath ?? '' }),
    // SQLMesh writes the marts: the writer key, scoped by config.py to the data path.
    ...(storage.kind === 's3'
      ? {
          ATLASBI_LAKEHOUSE_S3_ENDPOINT: storage.endpoint,
          ATLASBI_LAKEHOUSE_S3_REGION: storage.region,
          ATLASBI_LAKEHOUSE_S3_USE_SSL: String(storage.useSsl),
          ATLASBI_LAKEHOUSE_S3_ACCESS_KEY_ID: storage.accessKeyId,
          ATLASBI_LAKEHOUSE_S3_SECRET_ACCESS_KEY: storage.secretAccessKey,
        }
      : {}),
    ATLASBI_TRANSFORM_STATE_URL: target.stateConnectionString,
    ATLASBI_TRANSFORM_STATE_SCHEMA: stateSchema ?? '',
  };
}

const CREDENTIAL_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/(\/\/[^:/@\s]+:)[^@\s]*@/g, '$1***@'],
  [/(password\s*=\s*)('[^']*'|"[^"]*"|[^\s"';]+)/gi, '$1***'],
  [/(PASSWORD\s+)'(?:[^']|'')*'/gi, "$1'***'"],
  // SQLMesh builds CREATE SECRET (... SECRET '...') from config.py; a traceback may repeat it.
  [/(\bSECRET\s+)'(?:[^']|'')*'/gi, "$1'***'"],
  [/(['"]secret['"]\s*:\s*)(['"])[^'"]*\2/gi, '$1$2***$2'],
];

/** A Python traceback reduced to the exception it ends with; otherwise SQLMesh's last error line. */
export function describeFailure(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
  // A traceback ends with the exception, but DuckDB messages continue after it with `LINE 1: …`
  // and a caret; the exception header is the line worth showing.
  const exceptionLine = [...lines]
    .reverse()
    .find((line) => /^[\w.]+(Error|Exception)\b.*:/.test(line));
  const errorLine = output.includes('Traceback (most recent call last):')
    ? (exceptionLine ?? lines.at(-1))
    : ([...lines].reverse().find((line) => /^\s*Error:/.test(line)) ??
      exceptionLine ??
      lines.at(-1));
  const message = (errorLine ?? 'SQLMesh failed without output.').trim();
  return CREDENTIAL_PATTERNS.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    message,
  );
}
