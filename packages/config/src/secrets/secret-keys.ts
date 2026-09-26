import type { LakehouseConfig } from '../config-schema.ts';

/** Logical secret keys owned by the platform; adapters map them to their own storage. */
export const SECRET_KEYS = {
  databaseUrl: 'database.url',
  /** PostgreSQL catalog of the lakehouse — only with catalog type postgres. */
  lakehouseCatalogUrl: 'lakehouse.catalog-url',
  /** SQLMesh's state database — needed by bootstrap and `pnpm transform`, not by `pnpm dev`. */
  transformStateUrl: 'transform.state-url',
} as const;

/** Secrets a process that uses the platform database and the lakehouse must have at startup. */
export function requiredSecretKeys(lakehouse: LakehouseConfig): string[] {
  return [
    SECRET_KEYS.databaseUrl,
    ...(lakehouse.catalogType === 'postgres' ? [SECRET_KEYS.lakehouseCatalogUrl] : []),
  ];
}

/** Secrets `pnpm transform` (SQLMesh) needs on top of the lakehouse ones. */
export function transformSecretKeys(lakehouse: LakehouseConfig): string[] {
  return [...requiredSecretKeys(lakehouse), SECRET_KEYS.transformStateUrl];
}
