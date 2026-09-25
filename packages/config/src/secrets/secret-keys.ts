import type { LakehouseConfig } from '../config-schema.ts';

/** Logical secret keys owned by the platform; adapters map them to their own storage. */
export const SECRET_KEYS = {
  databaseUrl: 'database.url',
  /** PostgreSQL catalog of the lakehouse — only with catalog type postgres. */
  lakehouseCatalogUrl: 'lakehouse.catalog-url',
} as const;

/** Secrets a process that uses the platform database and the lakehouse must have at startup. */
export function requiredSecretKeys(lakehouse: LakehouseConfig): string[] {
  return [
    SECRET_KEYS.databaseUrl,
    ...(lakehouse.catalogType === 'postgres' ? [SECRET_KEYS.lakehouseCatalogUrl] : []),
  ];
}
