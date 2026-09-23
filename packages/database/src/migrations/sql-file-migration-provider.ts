import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { sql } from 'kysely';
import type { Migration, MigrationProvider } from 'kysely/migration';

const MIGRATION_FILE_NAME = /^\d{6}_[a-z0-9_]+\.sql$/;

/**
 * Kysely migration provider over plain `.sql` files (docs/19 §5), so migrations stay readable
 * SQL instead of TypeScript. Forward-only: a mistake is fixed by a new migration, never a `down`.
 */
export class SqlFileMigrationProvider implements MigrationProvider {
  readonly #folder: string;

  constructor(folder: string) {
    this.#folder = folder;
  }

  async getMigrations(): Promise<Record<string, Migration>> {
    const files = (await readdir(this.#folder)).filter((file) => file.endsWith('.sql')).sort();

    const misnamed = files.filter((file) => !MIGRATION_FILE_NAME.test(file));
    if (misnamed.length > 0) {
      throw new Error(
        `Migration files must be named 000001_description.sql (lowercase snake_case): ${misnamed.join(', ')}`,
      );
    }

    const migrations: Record<string, Migration> = {};
    for (const file of files) {
      const statements = await readFile(path.join(this.#folder, file), 'utf8');
      migrations[path.basename(file, '.sql')] = {
        up: async (db) => {
          await sql.raw(statements).execute(db);
        },
      };
    }
    return migrations;
  }
}
