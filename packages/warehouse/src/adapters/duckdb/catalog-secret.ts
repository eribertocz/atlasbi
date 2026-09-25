import { LakehouseError } from '@atlasbi/contracts';

import { quoteLiteral } from './sql-literals.ts';

/** Name of the DuckDB secret holding the PostgreSQL catalog credentials (never persisted). */
export const CATALOG_SECRET_NAME = 'lake_catalog';

const DEFAULT_POSTGRES_PORT = 5432;
const INVALID_URL_REMEDY =
  'Set the lakehouse.catalog-url secret to postgres://user:password@host:port/database.';

export interface PostgresCatalogParameters {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * The catalog URL is parsed here, never passed to ATTACH: DuckDB echoes a connection string —
 * password included — in its errors, while a secret's fields never appear in them (Phase 0, S7).
 * Error messages name what is wrong, never the URL itself.
 */
export function parsePostgresCatalogUrl(connectionString: string): PostgresCatalogParameters {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw invalidUrl('it is not a valid URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw invalidUrl('its scheme must be postgres://');
  }
  const unsupported = [...new Set(url.searchParams.keys())];
  if (unsupported.length > 0) {
    // Silently dropping e.g. sslmode=require would downgrade the connection without anyone noticing.
    throw invalidUrl(
      `it has parameters the catalog connection does not support (${unsupported.join(', ')})`,
    );
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const user = decodeURIComponent(url.username);
  if (url.hostname === '' || database === '' || user === '') {
    throw invalidUrl('it needs a host, a user and a database');
  }
  return {
    host: url.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: url.port === '' ? DEFAULT_POSTGRES_PORT : Number(url.port),
    database,
    user,
    password: decodeURIComponent(url.password),
  };
}

export function createCatalogSecretStatement(parameters: PostgresCatalogParameters): string {
  return (
    `CREATE TEMPORARY SECRET ${CATALOG_SECRET_NAME} (TYPE postgres, ` +
    `HOST ${quoteLiteral(parameters.host)}, PORT ${parameters.port}, ` +
    `DATABASE ${quoteLiteral(parameters.database)}, USER ${quoteLiteral(parameters.user)}, ` +
    `PASSWORD ${quoteLiteral(parameters.password)})`
  );
}

function invalidUrl(reason: string): LakehouseError {
  return new LakehouseError(
    'catalog_unreachable',
    `The lakehouse catalog URL is unusable: ${reason}.`,
    { remedy: INVALID_URL_REMEDY },
  );
}
