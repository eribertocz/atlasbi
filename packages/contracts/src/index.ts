export {
  AUTHENTICATION_ERROR_CODES,
  AuthenticationError,
  IDENTITY_PORT_VERSION,
} from './auth/identity-port.ts';
export type {
  AuthenticationErrorCode,
  Identity,
  IdentityPort,
  IdentityReconciliation,
  NewUser,
} from './auth/identity-port.ts';
export { IDENTITY_HTTP_OPERATIONS, IDENTITY_HTTP_VERSION } from './auth/identity-http.ts';
export type { IdentityHttpHandler, IdentityHttpOperation } from './auth/identity-http.ts';
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
export {
  FILTER_OPERATORS,
  SEMANTIC_QUERY_MAX_ROWS,
  SORT_DIRECTIONS,
  TIME_GRANULARITIES,
} from './semantic/semantic-query.ts';
export type {
  FilterOperator,
  SemanticFilter,
  SemanticOrder,
  SemanticQuery,
  SemanticTimeDimension,
  SortDirection,
  TimeGranularity,
} from './semantic/semantic-query.ts';
export { SEMANTIC_VALUE_TYPES } from './semantic/semantic-result.ts';
export type {
  SemanticColumn,
  SemanticMember,
  SemanticModel,
  SemanticResult,
  SemanticValue,
  SemanticValueType,
} from './semantic/semantic-result.ts';
export {
  SEMANTIC_RUNTIME_ERROR_CODES,
  SemanticRuntimeError,
} from './semantic/semantic-runtime-error.ts';
export type { SemanticRuntimeErrorCode } from './semantic/semantic-runtime-error.ts';
export { SEMANTIC_RUNTIME_PORT_VERSION } from './semantic/semantic-runtime-port.ts';
export type {
  SemanticQueryOptions,
  SemanticRuntimeCapabilities,
  SemanticRuntimePort,
} from './semantic/semantic-runtime-port.ts';
export {
  REPORT_GRID_COLUMNS,
  REPORT_SCHEMA_VERSION,
  visualPositionIssues,
} from './report/report-document.ts';
export type {
  ReportDocument,
  ReportPage,
  ReportSummary,
  ReportVisual,
  VisualPosition,
} from './report/report-document.ts';
export {
  InvalidVisualSpecError,
  parseVisualSpec,
  VISUAL_KINDS,
  VISUAL_SPEC_VERSION,
} from './report/visual-spec.ts';
export type { VisualEncoding, VisualKind, VisualSpec } from './report/visual-spec.ts';
export {
  DATA_CONTRACT_KINDS,
  InvalidDataContractError,
  LANDING_TECHNICAL_COLUMNS,
  majorVersion,
  parseDataContract,
} from './data/data-contract.ts';
export type {
  DataContract,
  DataContractColumn,
  DataContractKind,
  DataContractType,
} from './data/data-contract.ts';
export {
  getDataContract,
  listDataContracts,
  UnknownDataContractError,
} from './data/data-contracts.ts';
