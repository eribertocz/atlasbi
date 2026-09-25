export { checkDatabaseConnection, DatabaseUnavailableError } from './connection.ts';
export { ensureDatabaseExists } from './ensure-database.ts';
export {
  listPendingMigrations,
  MigrationFailedError,
  migrateToLatest,
} from './migrations/migrator.ts';
export type { MigrationOptions, MigrationRunSummary } from './migrations/migrator.ts';
