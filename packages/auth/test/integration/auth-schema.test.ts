import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createThrowawayDatabase } from '@atlasbi/database/testing';
import { getMigrations } from 'better-auth/db/migration';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { createAuthOptions } from '../../src/adapters/better-auth/auth-options.ts';
import { createAuthDatabase, developmentAdminUrl, testSecret } from './support/auth-database.ts';

const AUTH_MIGRATION = fileURLToPath(
  new URL('../../../database/migrations/000001_auth_schema.sql', import.meta.url),
);

// The contract between better-auth and the platform's migrations (docs/19 §5): the tables come
// from our Kysely migrator only, and they are exactly what the configured better-auth expects.
describe('the better-auth schema', () => {
  it('needs nothing more once the platform migrations are applied', async () => {
    const database = await createAuthDatabase();
    const pool = new pg.Pool({ connectionString: database.connectionString });
    try {
      const plan = await getMigrations(createAuthOptions({ pool, secret: testSecret() }));
      const pending = [...plan.toBeCreated, ...plan.toBeAdded];

      expect(
        pending,
        `better-auth expects schema changes — add them as a new migration:\n${await plan.compileMigrations()}`,
      ).toEqual([]);
    } finally {
      await pool.end();
      await database.drop();
    }
  });

  it('is committed exactly as the planner emits it for the platform options', async () => {
    const database = await createThrowawayDatabase(await developmentAdminUrl());
    const pool = new pg.Pool({ connectionString: database.connectionString });
    try {
      const plan = await getMigrations(createAuthOptions({ pool, secret: testSecret() }));
      const emitted = (await plan.compileMigrations()).trim();
      const committed = (await readFile(AUTH_MIGRATION, 'utf8'))
        .split('\n')
        .filter((line) => !line.startsWith('--'))
        .join('\n')
        .trim();

      expect(committed).toBe(emitted);
    } finally {
      await pool.end();
      await database.drop();
    }
  });
});
