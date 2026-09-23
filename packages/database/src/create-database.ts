import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

// Table types join this schema together with the migration that creates each table.
export type PlatformSchema = Record<string, never>;

export function createDatabase(connectionString: string): Kysely<PlatformSchema> {
  return new Kysely<PlatformSchema>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  });
}
