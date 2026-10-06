import { fileURLToPath } from 'node:url';

import { Migrator } from 'kysely/migration';

import { describeDriverError } from '../connection.ts';
import { createDatabase } from '../create-database.ts';
import { SqlFileMigrationProvider } from './sql-file-migration-provider.ts';

const PLATFORM_MIGRATIONS_FOLDER = fileURLToPath(new URL('../../migrations', import.meta.url));

export interface MigrationOptions {
  connectionString: string;
  /** Defaults to this package's `migrations/` folder; tests point it at fixtures. */
  migrationsFolder?: string;
}

export interface MigrationRunSummary {
  applied: string[];
}

export class MigrationFailedError extends Error {
  readonly migrationName: string | undefined;

  constructor(migrationName: string | undefined, reason: string) {
    super(
      migrationName === undefined
        ? `Migrations could not run: ${reason}`
        : `Migration ${migrationName} failed: ${reason}`,
    );
    this.name = 'MigrationFailedError';
    this.migrationName = migrationName;
  }
}

/**
 * Applies every pending migration. On Postgres, Kysely runs the whole batch in one transaction,
 * so a failure leaves the schema exactly as it was before the call.
 */
export async function migrateToLatest(options: MigrationOptions): Promise<MigrationRunSummary> {
  return withMigrator(options, async (migrator) => {
    const { error, results = [] } = await migrator.migrateToLatest();
    if (error !== undefined) {
      const failed = results.find((result) => result.status === 'Error');
      throw new MigrationFailedError(failed?.migrationName, describeDriverError(error));
    }
    return { applied: results.map((result) => result.migrationName) };
  });
}

/**
 * Applies pending migrations up to and including `target` (a file name without `.sql`) — for tests
 * that rebuild an earlier state to check what the next migration does to its data.
 */
export async function migrateTo(
  options: MigrationOptions & { target: string },
): Promise<MigrationRunSummary> {
  return withMigrator(options, async (migrator) => {
    const { error, results = [] } = await migrator.migrateTo(options.target);
    if (error !== undefined) {
      const failed = results.find((result) => result.status === 'Error');
      throw new MigrationFailedError(failed?.migrationName, describeDriverError(error));
    }
    return { applied: results.map((result) => result.migrationName) };
  });
}

export async function listPendingMigrations(options: MigrationOptions): Promise<string[]> {
  return withMigrator(options, async (migrator) => {
    const migrations = await migrator.getMigrations();
    return migrations
      .filter((migration) => migration.executedAt === undefined)
      .map((migration) => migration.name);
  });
}

async function withMigrator<T>(
  options: MigrationOptions,
  run: (migrator: Migrator) => Promise<T>,
): Promise<T> {
  const db = createDatabase(options.connectionString);
  try {
    const migrator = new Migrator({
      db,
      provider: new SqlFileMigrationProvider(
        options.migrationsFolder ?? PLATFORM_MIGRATIONS_FOLDER,
      ),
    });
    return await run(migrator);
  } finally {
    await db.destroy();
  }
}
