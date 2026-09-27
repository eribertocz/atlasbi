import type { LakehouseConfig } from '../config-schema.ts';

/** Logical secret keys owned by the platform; adapters map them to their own storage. */
export const SECRET_KEYS = {
  databaseUrl: 'database.url',
  /** PostgreSQL catalog of the lakehouse, as its owner — only with catalog type postgres. */
  lakehouseCatalogUrl: 'lakehouse.catalog-url',
  /** The same catalog through a SELECT-only role, for the readers (query port, Cube). */
  lakehouseCatalogReaderUrl: 'lakehouse.catalog-reader-url',
  /** Object storage key that owns the bucket: admin port, seed, SQLMesh. */
  lakehouseS3WriterAccessKeyId: 'lakehouse.s3-writer-access-key-id',
  lakehouseS3WriterSecretAccessKey: 'lakehouse.s3-writer-secret-access-key',
  /** Object storage key that can only read the bucket: query port, Cube. */
  lakehouseS3ReaderAccessKeyId: 'lakehouse.s3-reader-access-key-id',
  lakehouseS3ReaderSecretAccessKey: 'lakehouse.s3-reader-secret-access-key',
  /** Administration of the local object storage server — `pnpm bootstrap` only. */
  objectStorageAdminToken: 'object-storage.admin-token',
  /** SQLMesh's state database — needed by bootstrap and `pnpm transform`, not by `pnpm dev`. */
  transformStateUrl: 'transform.state-url',
  /** The secret Cube verifies the platform's short-lived query tokens with (CUBEJS_API_SECRET). */
  semanticApiSecret: 'semantic.api-secret',
  /** Password of Cube's SQL API (PostgreSQL wire protocol). */
  semanticSqlPassword: 'semantic.sql-password',
} as const;

/** Secrets that open the lakehouse as its writer (admin port, seed, SQLMesh). */
export function lakehouseWriterSecretKeys(lakehouse: LakehouseConfig): string[] {
  return lakehouse.catalogType === 'postgres'
    ? [
        SECRET_KEYS.lakehouseCatalogUrl,
        SECRET_KEYS.lakehouseS3WriterAccessKeyId,
        SECRET_KEYS.lakehouseS3WriterSecretAccessKey,
      ]
    : [];
}

/** Secrets that open the lakehouse read-only (query port, Cube). */
export function lakehouseReaderSecretKeys(lakehouse: LakehouseConfig): string[] {
  return lakehouse.catalogType === 'postgres'
    ? [
        SECRET_KEYS.lakehouseCatalogReaderUrl,
        SECRET_KEYS.lakehouseS3ReaderAccessKeyId,
        SECRET_KEYS.lakehouseS3ReaderSecretAccessKey,
      ]
    : [];
}

/** Secrets a process that uses the platform database and the lakehouse must have at startup. */
export function requiredSecretKeys(lakehouse: LakehouseConfig): string[] {
  return [SECRET_KEYS.databaseUrl, ...lakehouseWriterSecretKeys(lakehouse)];
}

/** Secrets `pnpm transform` (SQLMesh) needs on top of the lakehouse ones. */
export function transformSecretKeys(lakehouse: LakehouseConfig): string[] {
  return [...requiredSecretKeys(lakehouse), SECRET_KEYS.transformStateUrl];
}

/** The semantic layer (Cube) runs on the postgres tier only: it reads the lakehouse's S3 data. */
export function semanticSecretKeys(lakehouse: LakehouseConfig): string[] {
  return lakehouse.catalogType === 'postgres'
    ? [SECRET_KEYS.semanticApiSecret, SECRET_KEYS.semanticSqlPassword]
    : [];
}

/** Everything `pnpm bootstrap` sets up: writer and reader access, the storage administration, Cube. */
export function bootstrapSecretKeys(lakehouse: LakehouseConfig): string[] {
  return [
    ...transformSecretKeys(lakehouse),
    ...lakehouseReaderSecretKeys(lakehouse),
    ...(lakehouse.catalogType === 'postgres' ? [SECRET_KEYS.objectStorageAdminToken] : []),
    ...semanticSecretKeys(lakehouse),
  ];
}
