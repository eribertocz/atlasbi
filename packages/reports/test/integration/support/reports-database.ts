import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { EnvSecretProvider, SECRET_KEYS } from '@atlasbi/config';
import { migrateToLatest } from '@atlasbi/database';
import { createThrowawayDatabase, type ThrowawayDatabase } from '@atlasbi/database/testing';
import pg from 'pg';

const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../../.env', import.meta.url));

/** The people and workspaces a report needs, written straight into the platform's own tables. */
export interface ReportsFixture {
  database: ThrowawayDatabase;
  pool: pg.Pool;
  author: string;
  editor: string;
  workspaces: { comercial: string; finanzas: string };
}

/** A throwaway platform database with every migration applied — `pnpm dev` must run. */
export async function createReportsDatabase(): Promise<ReportsFixture> {
  if (existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  const database = await createThrowawayDatabase(
    await new EnvSecretProvider().get(SECRET_KEYS.databaseUrl),
  );
  const pool = new pg.Pool({ connectionString: database.connectionString, max: 2 });
  try {
    await migrateToLatest({ connectionString: database.connectionString });
    const organization = randomUUID();
    const [author, editor] = [randomUUID(), randomUUID()];
    await pool.query('INSERT INTO identity.organization (id) VALUES ($1)', [organization]);
    await pool.query('INSERT INTO identity.principal (id) VALUES ($1), ($2)', [author, editor]);
    const workspace = async (slug: string) => {
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO access.workspace (organization_id, slug, name) VALUES ($1, $2, $2) RETURNING id',
        [organization, slug],
      );
      return rows[0]?.id ?? '';
    };
    return {
      database,
      pool,
      author,
      editor,
      workspaces: {
        comercial: await workspace('comercial'),
        finanzas: await workspace('finanzas'),
      },
    };
  } catch (error) {
    await pool.end();
    await database.drop();
    throw error;
  }
}

/** The SQLSTATE a statement fails with, or `ok`. */
export async function outcomeOf(
  pool: pg.Pool,
  statement: string,
  values: unknown[] = [],
): Promise<string> {
  try {
    await pool.query(statement, values);
    return 'ok';
  } catch (error) {
    return error instanceof pg.DatabaseError ? (error.code ?? 'unknown') : 'not a database error';
  }
}
