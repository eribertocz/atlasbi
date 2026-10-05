import path from 'node:path';

import { LAKEHOUSE_CATALOG_TYPES, type LakehouseCatalogType } from '@atlasbi/contracts';
import { z } from 'zod';

/** Config Schema contract version (docs/21 §2) — bump when a variable changes meaning or is removed. */
export const CONFIG_SCHEMA_VERSION = 6;

const DUCKDB_CATALOG_REJECTION =
  'a DuckDB-file catalog allows a single client only and is not supported — use postgres (default) or sqlite (docs/01 §6.6)';

const catalogTypeSchema = z
  .enum(LAKEHOUSE_CATALOG_TYPES, {
    error: (issue) => (issue.input === 'duckdb' ? DUCKDB_CATALOG_REJECTION : undefined),
  })
  .default('postgres');

// `s3://bucket/` or `s3://bucket/prefix/`: bucket naming per S3, trailing slash as DuckLake records it.
const S3_URL = /^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/(?:[^\s/]+\/)*$/;
// host:port, never a scheme: DuckDB takes the scheme from USE_SSL.
const S3_ENDPOINT = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::\d{1,5})?$/;

const S3_DEFAULTS = {
  url: 's3://lakehouse/data/',
  endpoint: '127.0.0.1:53900',
  region: 'garage',
  useSsl: false,
} as const;

const lakehouseVariables = {
  ATLASBI_LAKEHOUSE_CATALOG_TYPE: catalogTypeSchema,
  ATLASBI_LAKEHOUSE_DATA_PATH: z.string().optional(),
  ATLASBI_LAKEHOUSE_SQLITE_PATH: z.string().default('.data/lakehouse/sqlite/catalog.sqlite'),
  ATLASBI_LAKEHOUSE_S3_URL: z
    .string()
    .regex(S3_URL, 'must look like s3://bucket/ or s3://bucket/prefix/ (with the trailing slash)')
    .optional(),
  ATLASBI_LAKEHOUSE_S3_ENDPOINT: z
    .string()
    .regex(S3_ENDPOINT, 'must be host:port, without a scheme (the scheme follows …_S3_USE_SSL)')
    .optional(),
  ATLASBI_LAKEHOUSE_S3_REGION: z.string().optional(),
  ATLASBI_LAKEHOUSE_S3_USE_SSL: z.enum(['true', 'false']).optional(),
  ATLASBI_DUCKDB_EXTENSION_DIRECTORY: z.string().default('.data/duckdb/extensions'),
};

const S3_VARIABLES = [
  'ATLASBI_LAKEHOUSE_S3_URL',
  'ATLASBI_LAKEHOUSE_S3_ENDPOINT',
  'ATLASBI_LAKEHOUSE_S3_REGION',
  'ATLASBI_LAKEHOUSE_S3_USE_SSL',
] as const;

/**
 * The catalog type is the deployment tier, and the tier fixes the storage (docs/11 §4.4): the
 * portable tier (sqlite) keeps its data files in a folder, the "equipo local" and cloud tiers
 * (postgres) in S3. A variable of the other tier is refused rather than silently ignored.
 */
function refineTier(
  environment: {
    ATLASBI_LAKEHOUSE_CATALOG_TYPE: LakehouseCatalogType;
  } & {
    [Name in 'ATLASBI_LAKEHOUSE_DATA_PATH' | (typeof S3_VARIABLES)[number]]?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (
    environment.ATLASBI_LAKEHOUSE_CATALOG_TYPE === 'postgres' &&
    environment.ATLASBI_LAKEHOUSE_DATA_PATH !== undefined
  ) {
    context.addIssue({
      code: 'custom',
      path: ['ATLASBI_LAKEHOUSE_DATA_PATH'],
      message:
        'a data folder belongs to the portable tier (sqlite catalog); with the postgres catalog the data files live in S3 — set ATLASBI_LAKEHOUSE_S3_URL instead (docs/11 §4.4)',
    });
  }
  if (environment.ATLASBI_LAKEHOUSE_CATALOG_TYPE === 'sqlite') {
    for (const name of S3_VARIABLES) {
      if (environment[name] !== undefined) {
        context.addIssue({
          code: 'custom',
          path: [name],
          message:
            'S3 storage belongs to the postgres catalog; the portable tier (sqlite) keeps its data files in a folder (ATLASBI_LAKEHOUSE_DATA_PATH)',
        });
      }
    }
  }
}

/** The lakehouse variables alone, so preflight can read them before the rest of .env exists. */
export const lakehouseEnvironmentSchema = z.object(lakehouseVariables).superRefine(refineTier);

/** An http(s) address with nothing after the host and port: a path would never match an Origin. */
const originUrl = z
  .url({ protocol: /^https?$/ })
  // zod runs refinements after a failed check too: an unparsable value is z.url()'s to report.
  .refine((value) => !URL.canParse(value) || new URL(value).origin === value.replace(/\/$/, ''), {
    message: 'must be scheme://host[:port] only — no path, query or fragment',
  });

/** Wire format: the non-secret environment variables a platform process reads. */
export const environmentSchema = z
  .object({
    ATLASBI_ENV: z.enum(['development', 'test', 'production']).default('development'),
    ATLASBI_SECRET_PROVIDER: z.enum(['env']).default('env'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
    /** The API gateway listens on 127.0.0.1 only (build step 5, decision G9). */
    ATLASBI_GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
    /**
     * The address the browser uses: the only trusted Origin of the identity layer, and https there
     * makes the session cookie Secure. In build step 6 it becomes the single domain (docs/19 §10).
     */
    ATLASBI_PUBLIC_URL: originUrl.default('http://127.0.0.1:4100'),
    /** Cube's REST API as the gateway reaches it. Follows ATLASBI_CUBE_PORT (compose). */
    ATLASBI_SEMANTIC_URL: originUrl.default('http://127.0.0.1:4000'),
    ...lakehouseVariables,
  })
  .superRefine(refineTier);

export type Environment = z.infer<typeof environmentSchema>;
export type LakehouseEnvironment = z.infer<typeof lakehouseEnvironmentSchema>;

/** Where the Parquet data files live; fixed by the tier (see refineTier). */
export type LakehouseStorageConfig =
  | {
      kind: 'folder';
      /** Absolute. */
      dataPath: string;
    }
  | {
      kind: 's3';
      /** `s3://bucket/prefix/` — identical for every process, on the host or in a container. */
      url: string;
      /** host:port as seen from this process. */
      endpoint: string;
      region: string;
      useSsl: boolean;
    };

export interface LakehouseConfig {
  catalogType: LakehouseCatalogType;
  storage: LakehouseStorageConfig;
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
  gateway: {
    port: number;
    /** An origin: scheme, host and port, without a trailing slash. */
    publicUrl: string;
  };
  semantic: {
    /** Whether the semantic layer runs in this deployment (see {@link semanticLayerRuns}). */
    enabled: boolean;
    /** The semantic layer's REST address, without a trailing slash. */
    url: string;
  };
  lakehouse: LakehouseConfig;
}

/**
 * The semantic layer reads the lakehouse's S3 data, so it runs on the postgres tier only — the
 * portable tier keeps its data in a local folder no container reaches (docs/04 §6.6). The one place
 * that decides it: callers ask `config.semantic.enabled`, never the catalog type.
 */
export function semanticLayerRuns(lakehouse: LakehouseConfig): boolean {
  return lakehouse.catalogType === 'postgres';
}

export function toPlatformConfig(environment: Environment, baseDirectory: string): PlatformConfig {
  const lakehouse = toLakehouseConfig(environment, baseDirectory);
  return {
    environment: environment.ATLASBI_ENV,
    secretProvider: environment.ATLASBI_SECRET_PROVIDER,
    telemetry: {
      otlpEndpoint: environment.OTEL_EXPORTER_OTLP_ENDPOINT,
    },
    gateway: {
      port: environment.ATLASBI_GATEWAY_PORT,
      publicUrl: new URL(environment.ATLASBI_PUBLIC_URL).origin,
    },
    semantic: {
      enabled: semanticLayerRuns(lakehouse),
      url: new URL(environment.ATLASBI_SEMANTIC_URL).origin,
    },
    lakehouse,
  };
}

/** Relative paths are resolved against `baseDirectory` (the workspace root for the CLI). */
export function toLakehouseConfig(
  environment: LakehouseEnvironment,
  baseDirectory: string,
): LakehouseConfig {
  const catalogType = environment.ATLASBI_LAKEHOUSE_CATALOG_TYPE;
  const resolve = (value: string) => path.resolve(baseDirectory, value);
  const storage: LakehouseStorageConfig =
    catalogType === 'postgres'
      ? {
          kind: 's3',
          url: environment.ATLASBI_LAKEHOUSE_S3_URL ?? S3_DEFAULTS.url,
          endpoint: environment.ATLASBI_LAKEHOUSE_S3_ENDPOINT ?? S3_DEFAULTS.endpoint,
          region: environment.ATLASBI_LAKEHOUSE_S3_REGION ?? S3_DEFAULTS.region,
          useSsl:
            environment.ATLASBI_LAKEHOUSE_S3_USE_SSL === undefined
              ? S3_DEFAULTS.useSsl
              : environment.ATLASBI_LAKEHOUSE_S3_USE_SSL === 'true',
        }
      : {
          kind: 'folder',
          dataPath: resolve(
            environment.ATLASBI_LAKEHOUSE_DATA_PATH ?? '.data/lakehouse/sqlite/files',
          ),
        };
  return {
    catalogType,
    storage,
    sqliteCatalogPath: resolve(environment.ATLASBI_LAKEHOUSE_SQLITE_PATH),
    extensionDirectory: resolve(environment.ATLASBI_DUCKDB_EXTENSION_DIRECTORY),
  };
}
