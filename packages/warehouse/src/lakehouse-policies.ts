/**
 * Inlining v1 (docs/01 §6.7): inserts of at most `rowLimit` rows stay in the catalog until an
 * explicit flush; bigger ones go straight to Parquet. The limit is persisted in the catalog at
 * provisioning, so every writer — the platform, transformation, ingestion — obeys it whatever its
 * client settings.
 */
export const INLINING_POLICY = { version: 1, rowLimit: 10 } as const;

/**
 * The only DuckLake catalog format this platform reads and writes. Changing it is an explicit,
 * administrative migration that re-validates the compatibility matrix (docs/versions.md) —
 * never an automatic side effect of attaching with a newer extension.
 */
export const SUPPORTED_CATALOG_FORMAT = '1.0';
