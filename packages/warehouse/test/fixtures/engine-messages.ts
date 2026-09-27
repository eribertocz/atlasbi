/**
 * Engine messages captured verbatim in Phase 0 (DuckDB 1.5.5, ducklake d8a1881e, Windows) — only
 * long local paths were shortened. The error mapper is tested against what the engine really
 * says, not against what we expect it to say.
 */
export const ENGINE_MESSAGES = {
  extensionMissing:
    'IO Error: Extension "C:\\work\\s3-empty-extensions\\v1.5.5\\windows_amd64\\ducklake.duckdb_extension" not found.\nExtension "ducklake" is an existing extension.\n\nInstall it first using "INSTALL ducklake".',
  wrongPasswordInConnectionString:
    'IO Error: Failed to attach DuckLake MetaData "__ducklake_metadata_lake" at path + "postgres:host=127.0.0.1 port=55432 dbname=phase0_s7 user=atlasbi password=wrong-pass"Unable to connect to Postgres at "host=127.0.0.1 port=55432 dbname=phase0_s7 user=atlasbi password=wrong-pass": connection to server at "127.0.0.1", port 55432 failed: FATAL:  password authentication failed for user "atlasbi"\n',
  serverUnreachableInConnectionString:
    'IO Error: Failed to attach DuckLake MetaData "__ducklake_metadata_lake2" at path + "postgres:host=127.0.0.1 port=1 dbname=phase0_s7 user=atlasbi password=atlasbi-dev-only"Unable to connect to Postgres at "host=127.0.0.1 port=1 dbname=phase0_s7 user=atlasbi password=atlasbi-dev-only": connection to server at "127.0.0.1", port 1 failed: Connection refused (0x0000274D/10061)\n\tIs the server running on that host and accepting TCP/IP connections?\n',
  serverUnreachableWithSecret:
    'IO Error: Failed to attach DuckLake MetaData "__ducklake_metadata_lake" at path + "postgres:"Unable to connect to Postgres at "": connection to server at "127.0.0.1", port 1 failed: Connection refused (0x0000274D/10061)\n\tIs the server running on that host and accepting TCP/IP connections?\n',
  databaseMissing:
    'IO Error: Failed to attach DuckLake MetaData "__ducklake_metadata_lake3" at path + "postgres:host=127.0.0.1 port=55432 dbname=phase0_missing user=atlasbi password=atlasbi-dev-only"Unable to connect to Postgres at "host=127.0.0.1 port=55432 dbname=phase0_missing user=atlasbi password=atlasbi-dev-only": connection to server at "127.0.0.1", port 55432 failed: FATAL:  database "phase0_missing" does not exist\n',
  dataPathMismatch:
    'Invalid Configuration Error: DATA_PATH parameter "C:/work/s7-pg/elsewhere\\" does not match existing data path in the catalog "C:/work/s7-pg/files/".\nYou can override the DATA_PATH by setting OVERRIDE_DATA_PATH to True.',
  notProvisioned:
    'Invalid Input Error: Existing DuckLake at metadata catalog "postgres:host=127.0.0.1 port=55432 dbname=phase0_s7_empty user=atlasbi password=atlasbi-dev-only" does not exist - and creating a new DuckLake is explicitly disabled',
  writeConflict:
    'TransactionContext Error: Failed to commit: Failed to commit DuckLake transaction.\nTransaction conflict - attempting to create table "dup" in schema "main" - but this table has been created by another transaction already',
  syntaxError: 'Parser Error: syntax error at or near "SELEC"\n\nLINE 1: SELEC 1\n        ^',
  conversionEchoingLiteral:
    "Conversion Error: Could not convert string 'customer-secret-42' to INT32\n\nLINE 1: SELECT 'customer-secret-42'::INTEGER\n                                   ^",
  missingTable:
    'Catalog Error: Table with name nope does not exist!\nDid you mean "dup"?\n\nLINE 1: SELECT * FROM lake.nope\n                      ^',
  connectionClosed: 'Failed to query: connection disconnected',
  formatTooOld:
    'Invalid Input Error: DuckLake catalog version mismatch: catalog version is 0.3, but the extension requires version 1.0. To automatically migrate, set AUTOMATIC_MIGRATION to TRUE when attaching.',
  formatTooNew:
    'Invalid Input Error: DuckLake catalog version mismatch: catalog version is 9.9, but the extension requires version 1.0. To automatically migrate, set AUTOMATIC_MIGRATION to TRUE when attaching.',
  sqliteLockedOnCommit:
    'TransactionContext Error: Failed to commit: Failed to commit DuckLake transaction.\nFailed to commit: Failed to execute query "COMMIT": database is locked',
  sqliteLockedOnFlush:
    'TransactionContext Error: Failed to commit: Failed to commit DuckLake transaction.\nFailed to flush changes into DuckLake: database is locked',
  readOnlyInsert:
    'Invalid Input Error: Cannot execute statement of type "INSERT" on database "lake" which is attached in read-only mode!',
  lockedConfiguration:
    'Invalid Input Error: Cannot change configuration option "enable_external_access" - the configuration has been locked',
  // Build step 3, `pnpm bootstrap` on a 0.2.0 lakehouse (postgres + folder) under Config Schema v4.
  dataPathTierChange:
    'Invalid Configuration Error: DATA_PATH parameter "s3://lakehouse/data/" does not match existing data path in the catalog "E:/bi-platform/.data/lakehouse/postgres/files/".\nYou can override the DATA_PATH by setting OVERRIDE_DATA_PATH to True.',
  // Object storage, captured in build step 3 against Garage v2.4.1 (httpfs 827222f); object keys
  // shortened.
  s3ReadWrongSecret:
    "HTTP Error: HTTP GET error reading 'http://127.0.0.1:53900/lakehouse/tests/capture/main/t/ducklake-01a0defe.parquet' in region 'garage' (HTTP 403 Forbidden)\n\nAccessDenied: Forbidden: Invalid signature\n\nAuthentication Failure - this is usually caused by invalid or missing credentials.\n* Credentials are provided, but they did not work.\n* See https://duckdb.org/docs/stable/extensions/httpfs/s3api.html",
  s3WriteWrongSecret:
    'HTTP Error: Unable to connect to URL s3://lakehouse/tests/capture/main/t/ducklake-01a0defe.parquet: Forbidden (HTTP code 403)\n\nAccessDenied: Forbidden: Invalid signature',
  s3UnknownKey:
    "HTTP Error: HTTP GET error reading 'http://127.0.0.1:53900/lakehouse/tests/capture/main/t/ducklake-01a0defe.parquet' in region 'garage' (HTTP 403 Forbidden)\n\nAccessDenied: Forbidden: No such key: GK000000000000000000000000\n\nAuthentication Failure - this is usually caused by invalid or missing credentials.\n* Credentials are provided, but they did not work.\n* See https://duckdb.org/docs/stable/extensions/httpfs/s3api.html",
  s3ReaderKeyWrites:
    'HTTP Error: Unable to connect to URL s3://lakehouse/tests/capture/main/t/ducklake-01a0defe.parquet: Forbidden (HTTP code 403)\n\nAccessDenied: Forbidden: Operation is not allowed for this key.',
  s3EndpointDown:
    "IO Error: Could not connect to server error for HTTP GET to 'http://127.0.0.1:53999/lakehouse/tests/capture/main/t/ducklake-01a0defe.parquet'",
  s3UnknownHost:
    "IO Error: Could not resolve hostname error for HTTP GET to 'http://no-such-host.invalid:3900/lakehouse/tests/capture/main/t/ducklake-01a0defe.parquet'",
  s3MissingBucketOnWrite:
    'HTTP Error: Unable to connect to URL s3://no-such-bucket-atlasbi/capture/main/u/ducklake-01a0deff.parquet: Not Found (HTTP code 404)\n\nNoSuchBucket: Bucket not found: no-such-bucket-atlasbi',
  s3MissingBucketOnList:
    "HTTP Error: HTTP GET error reading 's3://no-such-bucket-atlasbi/capture' in region 'garage' (HTTP 404 Not Found)\n\nNoSuchBucket: Bucket not found: no-such-bucket-atlasbi\n\nLINE 1: SELECT count(*) FROM glob('s3://no-such-bucket-atlasbi/capture...\n                             ^",
  s3DataFileDeleted:
    "HTTP Error: HTTP GET error reading 'http://127.0.0.1:53900/lakehouse/tests/capture/main/t/ducklake-01a0df99.parquet' in region 'garage' (HTTP 404 Not Found)\n\nNoSuchKey: Key not found",
  outsideAllowedDirectories:
    'Permission Error: Cannot access file "C:/work/outside-secret.csv" - file system operations are disabled by configuration\n\nLINE 1: SELECT * FROM read_csv(\'C:/work/outside-secret.csv\')\n                      ^',
} as const;
