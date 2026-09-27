'use strict';

// How Cube's DuckDB instance opens the lakehouse (build step 3, docs/04 §6): as its reader — the
// SELECT-only catalog role and the read-only storage key — in the order the platform's own read port
// uses (docs/01 §6.7): load, secrets, READ_ONLY attach, then the hardening. No dependency, so it is
// unit-tested in the repository and runs unchanged inside the Cube container.

/** Where the container finds the extensions `pnpm bootstrap` installed (mounted read-only). */
const EXTENSION_DIRECTORY = '/duckdb/extensions';

/** What a client of Cube is told when the lakehouse cannot be reached: nothing internal. */
const CLIENT_MESSAGE =
  'The lakehouse is unavailable to the semantic layer; the details are in the Cube logs.';

// Never Cube's defaults: they would install a missing extension from the Internet, silently.
function instanceOptions() {
  return {
    extension_directory: EXTENSION_DIRECTORY,
    autoinstall_known_extensions: 'false',
    autoload_known_extensions: 'false',
    allow_unsigned_extensions: 'false',
  };
}

function required(env, name) {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set (compose.yaml passes it from .env)`);
  }
  return value;
}

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * The reader's settings from the container environment. The catalog URL is the one .env declares
 * for the host; inside the stack network its host and port are overridden (postgres:5432).
 */
function readerSettings(env) {
  const catalog = new URL(required(env, 'ATLASBI_LAKEHOUSE_CATALOG_READER_URL'));
  const dataPath = required(env, 'ATLASBI_LAKEHOUSE_S3_URL');
  if (!/^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/(?:[^\s/]+\/)*$/.test(dataPath)) {
    throw new Error('ATLASBI_LAKEHOUSE_S3_URL must look like s3://bucket/ or s3://bucket/prefix/');
  }
  return {
    catalog: {
      host: env.ATLASBI_LAKEHOUSE_CATALOG_HOST || catalog.hostname,
      port: Number(env.ATLASBI_LAKEHOUSE_CATALOG_PORT || catalog.port || 5432),
      database: decodeURIComponent(catalog.pathname.replace(/^\//, '')),
      user: decodeURIComponent(catalog.username),
      password: decodeURIComponent(catalog.password),
    },
    dataPath,
    storage: {
      endpoint: required(env, 'ATLASBI_LAKEHOUSE_S3_ENDPOINT'),
      region: required(env, 'ATLASBI_LAKEHOUSE_S3_REGION'),
      useSsl: required(env, 'ATLASBI_LAKEHOUSE_S3_USE_SSL') === 'true',
      accessKeyId: required(env, 'ATLASBI_LAKEHOUSE_S3_READER_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'ATLASBI_LAKEHOUSE_S3_READER_SECRET_ACCESS_KEY'),
    },
  };
}

/** Everything the instance runs once, in order; any failure must stop the lakehouse from opening. */
function lakehouseStatements(env) {
  const { catalog, dataPath, storage } = readerSettings(env);
  return [
    'LOAD ducklake',
    'LOAD postgres',
    'LOAD httpfs',
    "SET GLOBAL TimeZone = 'UTC'",
    `CREATE TEMPORARY SECRET lake_catalog (TYPE postgres, HOST ${literal(catalog.host)}, ` +
      `PORT ${catalog.port}, DATABASE ${literal(catalog.database)}, USER ${literal(catalog.user)}, ` +
      `PASSWORD ${literal(catalog.password)})`,
    `CREATE TEMPORARY SECRET lake_storage (TYPE s3, KEY_ID ${literal(storage.accessKeyId)}, ` +
      `SECRET ${literal(storage.secretAccessKey)}, ENDPOINT ${literal(storage.endpoint)}, ` +
      `REGION ${literal(storage.region)}, URL_STYLE 'path', USE_SSL ${storage.useSsl}, ` +
      `SCOPE ${literal(dataPath)})`,
    `ATTACH 'ducklake:postgres:' AS lake (META_SECRET 'lake_catalog', DATA_PATH ${literal(dataPath)}, ` +
      'CREATE_IF_NOT_EXISTS false, OVERRIDE_DATA_PATH false, READ_ONLY)',
    `SET GLOBAL allowed_directories = [${literal(dataPath)}]`,
    'SET GLOBAL enable_external_access = false',
    'SET GLOBAL lock_configuration = true',
  ];
}

const CREDENTIAL_PATTERNS = [
  [/(\/\/[^:/@\s]+:)[^@\s]*@/g, '$1***@'],
  [/(password\s*=\s*)('[^']*'|"[^"]*"|[^\s"';]+)/gi, '$1***'],
  [/(PASSWORD\s+)'(?:[^']|'')*'/gi, "$1'***'"],
  [/(\bSECRET\s+)'(?:[^']|'')*'/gi, "$1'***'"],
  [/(X-Amz-(?:Signature|Credential|Security-Token)=)[^&\s'"]+/gi, '$1***'],
];

/** For the Cube logs: the engine's first line, without anything that could be a credential. */
function describeForLog(error) {
  const message = String(error instanceof Error ? error.message : error).split('\n')[0] ?? '';
  return CREDENTIAL_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    message,
  );
}

// Errors of reaching the lakehouse (catalog, storage, extensions) are internal: hosts, addresses,
// users and keys. Errors of the query itself (a column the model names wrongly) stay useful as they are.
const LAKEHOUSE_ACCESS_ERROR =
  /IO Error|HTTP Error|Failed to attach|Unable to connect|Could not connect|Could not resolve|Extension .* not found|Permission Error/;

function isLakehouseAccessError(error) {
  return LAKEHOUSE_ACCESS_ERROR.test(String(error instanceof Error ? error.message : error));
}

module.exports = {
  CLIENT_MESSAGE,
  EXTENSION_DIRECTORY,
  describeForLog,
  instanceOptions,
  isLakehouseAccessError,
  lakehouseStatements,
};
