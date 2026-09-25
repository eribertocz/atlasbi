import path from 'node:path';

import { LAKEHOUSE_CATALOG_TYPES, type LakehouseCatalogType } from '@atlasbi/contracts';
import { z } from 'zod';

/** Config Schema contract version (docs/21 §2) — bump when a variable changes meaning or is removed. */
export const CONFIG_SCHEMA_VERSION = 2;

const DUCKDB_CATALOG_REJECTION =
  'a DuckDB-file catalog allows a single client only and is not supported — use postgres (default) or sqlite (docs/01 §6.6)';

const catalogTypeSchema = z
  .enum(LAKEHOUSE_CATALOG_TYPES, {
    error: (issue) => (issue.input === 'duckdb' ? DUCKDB_CATALOG_REJECTION : undefined),
  })
  .default('postgres');

/** The lakehouse variables alone, so preflight can read them before the rest of .env exists. */
export const lakehouseEnvironmentSchema = z.object({
  ATLASBI_LAKEHOUSE_CATALOG_TYPE: catalogTypeSchema,
  ATLASBI_LAKEHOUSE_DATA_PATH: z.string().optional(),
  ATLASBI_LAKEHOUSE_SQLITE_PATH: z.string().default('.data/lakehouse/sqlite/catalog.sqlite'),
  ATLASBI_DUCKDB_EXTENSION_DIRECTORY: z.string().default('.data/duckdb/extensions'),
});

/** Wire format: the non-secret environment variables a platform process reads. */
export const environmentSchema = z.object({
  ATLASBI_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ATLASBI_SECRET_PROVIDER: z.enum(['env']).default('env'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
  ...lakehouseEnvironmentSchema.shape,
});

export type Environment = z.infer<typeof environmentSchema>;
export type LakehouseEnvironment = z.infer<typeof lakehouseEnvironmentSchema>;

export interface LakehouseConfig {
  catalogType: LakehouseCatalogType;
  /** Absolute. Defaults to one folder per catalog type, so switching type never mixes files. */
  dataPath: string;
  /** Absolute; only read when catalogType is sqlite. */
  sqliteCatalogPath: string;
  /** Absolute; `pnpm bootstrap` installs the DuckDB extensions here. */
  extensionDirectory: string;
}

/** Domain shape of the configuration — code never reads env var names directly. */
export interface PlatformConfig {
  environment: Environment['ATLASBI_ENV'];
  secretProvider: Environment['ATLASBI_SECRET_PROVIDER'];
  telemetry: {
    otlpEndpoint: string;
  };
  lakehouse: LakehouseConfig;
}

export function toPlatformConfig(environment: Environment, baseDirectory: string): PlatformConfig {
  return {
    environment: environment.ATLASBI_ENV,
    secretProvider: environment.ATLASBI_SECRET_PROVIDER,
    telemetry: {
      otlpEndpoint: environment.OTEL_EXPORTER_OTLP_ENDPOINT,
    },
    lakehouse: toLakehouseConfig(environment, baseDirectory),
  };
}

/** Relative paths are resolved against `baseDirectory` (the workspace root for the CLI). */
export function toLakehouseConfig(
  environment: LakehouseEnvironment,
  baseDirectory: string,
): LakehouseConfig {
  const catalogType = environment.ATLASBI_LAKEHOUSE_CATALOG_TYPE;
  const resolve = (value: string) => path.resolve(baseDirectory, value);
  return {
    catalogType,
    dataPath: resolve(
      environment.ATLASBI_LAKEHOUSE_DATA_PATH ?? `.data/lakehouse/${catalogType}/files`,
    ),
    sqliteCatalogPath: resolve(environment.ATLASBI_LAKEHOUSE_SQLITE_PATH),
    extensionDirectory: resolve(environment.ATLASBI_DUCKDB_EXTENSION_DIRECTORY),
  };
}
