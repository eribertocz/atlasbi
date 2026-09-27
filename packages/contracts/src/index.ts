export {
  AUTHENTICATION_ERROR_CODES,
  AuthenticationError,
  IDENTITY_PORT_VERSION,
} from './auth/identity-port.ts';
export type {
  AuthenticationErrorCode,
  Identity,
  IdentityPort,
  NewUser,
} from './auth/identity-port.ts';
export {
  ACCESS_DENIED_REASONS,
  AccessDeniedError,
  SECURITY_CONTEXT_VERSION,
  WORKSPACE_ROLES,
} from './auth/security-context.ts';
export type {
  AccessDeniedReason,
  DataEntitlement,
  SecurityContext,
  WorkspaceRole,
} from './auth/security-context.ts';
export {
  ANALYTICAL_QUERY_PORT_VERSION,
  DEFAULT_QUERY_MAX_ROWS,
} from './lakehouse/analytical-query-port.ts';
export type {
  AnalyticalQueryCapabilities,
  AnalyticalQueryPort,
  QueryOptions,
} from './lakehouse/analytical-query-port.ts';
export {
  LAKEHOUSE_ADMIN_PORT_VERSION,
  LAKEHOUSE_CATALOG_TYPES,
} from './lakehouse/lakehouse-admin-port.ts';
export type {
  ExecuteResult,
  FlushResult,
  LakehouseAdminCapabilities,
  LakehouseAdminPort,
  LakehouseCatalogType,
  LakehouseHealth,
} from './lakehouse/lakehouse-admin-port.ts';
export { LAKEHOUSE_ERROR_CODES, LakehouseError } from './lakehouse/lakehouse-error.ts';
export type { LakehouseErrorCode, LakehouseErrorOptions } from './lakehouse/lakehouse-error.ts';
export type {
  LogicalType,
  QueryColumn,
  QueryParameter,
  QueryResult,
  QueryRow,
  QueryValue,
  StructField,
} from './lakehouse/query-result.ts';
export { SecretNotFoundError } from './secret-provider.ts';
export type { SecretProvider } from './secret-provider.ts';
