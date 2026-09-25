import { CATALOG_SECRET_NAME } from './catalog-secret.ts';
import { quoteLiteral } from './sql-literals.ts';

/** Alias of the attached lakehouse — the `lake` in `lake.schema.table`. */
export const LAKE_ALIAS = 'lake';

/** `provision` is the only access that may create a lakehouse; it runs from bootstrap alone. */
export type LakehouseAccess = 'read' | 'write' | 'provision';

export type EngineCatalog = { type: 'postgres' } | { type: 'sqlite'; path: string };

export interface AttachOptions {
  catalog: EngineCatalog;
  /** Canonical form from resolveLakehouseLocation. */
  dataPath: string;
  access: LakehouseAccess;
  overrideDataPath: boolean;
}

/**
 * Every DuckLake default that could fail silently is set explicitly (docs/01 §6.7): with the
 * defaults, a typo in a path would create an empty lakehouse, or hide the real one, instead of
 * failing. AUTOMATIC_MIGRATION is never passed, so the catalog format only changes on purpose.
 */
export function buildAttachStatement(options: AttachOptions): string {
  const target =
    options.catalog.type === 'postgres'
      ? quoteLiteral('ducklake:postgres:')
      : quoteLiteral(`ducklake:sqlite:${options.catalog.path}`);
  const attachOptions = [
    ...(options.catalog.type === 'postgres'
      ? [`META_SECRET ${quoteLiteral(CATALOG_SECRET_NAME)}`]
      : []),
    `DATA_PATH ${quoteLiteral(options.dataPath)}`,
    `OVERRIDE_DATA_PATH ${options.overrideDataPath}`,
    `CREATE_IF_NOT_EXISTS ${options.access === 'provision'}`,
    ...(options.access === 'read' ? ['READ_ONLY'] : []),
  ];
  return `ATTACH ${target} AS ${LAKE_ALIAS} (${attachOptions.join(', ')})`;
}
