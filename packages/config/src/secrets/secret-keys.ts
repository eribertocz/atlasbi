import { type LakehouseConfig, semanticLayerRuns } from '../config-schema.ts';

/** Logical secret keys owned by the platform; adapters map them to their own storage. */
export const SECRET_KEYS = {
  databaseUrl: 'database.url',
  /** PostgreSQL catalog of the lakehouse, as its owner — only with catalog type postgres. */
  lakehouseCatalogUrl: 'lakehouse.catalog-url',
  /** The same catalog through a SELECT-only role, for the readers (query port, Cube). */
  lakehouseCatalogReaderUrl: 'lakehouse.catalog-reader-url',
  /** Object storage key that owns the bucket: admin port, seed, the transformation. */
  lakehouseS3WriterAccessKeyId: 'lakehouse.s3-writer-access-key-id',
  lakehouseS3WriterSecretAccessKey: 'lakehouse.s3-writer-secret-access-key',
  /** Object storage key that can only read the bucket: query port, Cube. */
  lakehouseS3ReaderAccessKeyId: 'lakehouse.s3-reader-access-key-id',
  lakehouseS3ReaderSecretAccessKey: 'lakehouse.s3-reader-secret-access-key',
  /** Administration of the local object storage server — `pnpm bootstrap` only. */
  objectStorageAdminToken: 'object-storage.admin-token',
  /** The transformation's state database — bootstrap and `pnpm transform`, not `pnpm dev`. */
  transformStateUrl: 'transform.state-url',
  /** The secret Cube verifies the platform's short-lived query tokens with (CUBEJS_API_SECRET). */
  semanticApiSecret: 'semantic.api-secret',
  /** Signs sessions and encrypts the identity token's private keys (better-auth `secret`). */
  authSecret: 'auth.secret',
  /** Password of the demo users `pnpm seed` creates — development only (docs/19 §6). */
  seedDemoPassword: 'seed.demo-password',
  /** Read-only token for GitHub's API — `pnpm ingest github` (build step 7). */
  githubToken: 'github.token',
} as const;

/** Secrets that open the lakehouse as its writer (admin port, seed, the transformation). */
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

/** Secrets `pnpm transform` needs on top of the lakehouse ones. */
export function transformSecretKeys(lakehouse: LakehouseConfig): string[] {
  return [...requiredSecretKeys(lakehouse), SECRET_KEYS.transformStateUrl];
}

/**
 * Only where the semantic layer runs (`semanticLayerRuns`). Its SQL API has no password of its own:
 * it accepts the platform's short query token (decision E5).
 */
export function semanticSecretKeys(lakehouse: LakehouseConfig): string[] {
  return semanticLayerRuns(lakehouse) ? [SECRET_KEYS.semanticApiSecret] : [];
}

/** Identity (better-auth) runs on every tier: its tables live in the platform database. */
export function authSecretKeys(): string[] {
  return [SECRET_KEYS.authSecret];
}

/**
 * The API gateway: the platform database (identity and access), `auth.secret` (sessions, identity
 * tokens) and, on the postgres tier, the secret it signs Cube's query tokens with.
 */
export function gatewaySecretKeys(lakehouse: LakehouseConfig): string[] {
  return [SECRET_KEYS.databaseUrl, ...authSecretKeys(), ...semanticSecretKeys(lakehouse)];
}

/**
 * `pnpm ingest <source>`: the lakehouse as its writer (the ingestion writes the landing, decision
 * K3) and the source's own credentials — never the platform database, which it does not use.
 */
export function ingestionSecretKeys(lakehouse: LakehouseConfig, source: 'github'): string[] {
  const sourceKeys: Record<typeof source, string[]> = { github: [SECRET_KEYS.githubToken] };
  return [...lakehouseWriterSecretKeys(lakehouse), ...sourceKeys[source]];
}

/** Everything `pnpm bootstrap` sets up: writer and reader access, the storage administration, Cube. */
export function bootstrapSecretKeys(lakehouse: LakehouseConfig): string[] {
  return [
    ...transformSecretKeys(lakehouse),
    ...lakehouseReaderSecretKeys(lakehouse),
    ...(lakehouse.catalogType === 'postgres' ? [SECRET_KEYS.objectStorageAdminToken] : []),
    ...semanticSecretKeys(lakehouse),
    ...authSecretKeys(),
  ];
}
