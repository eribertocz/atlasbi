import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkDatabaseConnection,
  listPendingMigrations,
  MigrationFailedError,
  migrateToLatest,
} from '../../src/index.ts';
import { createThrowawayDatabase, type ThrowawayDatabase } from '../../src/testing/index.ts';
import { developmentAdminUrl } from './support/development-admin-url.ts';

const fixtures = (name: string) =>
  fileURLToPath(new URL(`../fixtures/migrations/${name}`, import.meta.url));

describe('platform migrations against a real Postgres', () => {
  let database: ThrowawayDatabase;

  beforeEach(async () => {
    database = await createThrowawayDatabase(await developmentAdminUrl());
  });

  afterEach(async () => {
    await database.drop();
  });

  it('applies pending migrations in order, including multi-statement files', async () => {
    const options = {
      connectionString: database.connectionString,
      migrationsFolder: fixtures('valid'),
    };

    await expect(listPendingMigrations(options)).resolves.toEqual([
      '000001_create_example',
      '000002_seed_example',
    ]);
    await expect(migrateToLatest(options)).resolves.toEqual({
      applied: ['000001_create_example', '000002_seed_example'],
    });
    await expect(countRows(database.connectionString, 'example')).resolves.toBe(2);
  });

  it('is idempotent: a second run applies nothing', async () => {
    const options = {
      connectionString: database.connectionString,
      migrationsFolder: fixtures('valid'),
    };
    await migrateToLatest(options);

    await expect(migrateToLatest(options)).resolves.toEqual({ applied: [] });
    await expect(listPendingMigrations(options)).resolves.toEqual([]);
  });

  it('rolls the whole batch back when one migration fails', async () => {
    const options = {
      connectionString: database.connectionString,
      migrationsFolder: fixtures('failing'),
    };

    const error: unknown = await migrateToLatest(options).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(MigrationFailedError);
    expect((error as MigrationFailedError).migrationName).toBe('000002_broken');
    await expect(tableExists(database.connectionString, 'example')).resolves.toBe(false);
  });

  it('reports the platform migrations folder as fully applied once migrated', async () => {
    await migrateToLatest({ connectionString: database.connectionString });

    await expect(
      listPendingMigrations({ connectionString: database.connectionString }),
    ).resolves.toEqual([]);
  });
});

describe('checkDatabaseConnection', () => {
  it('succeeds against a reachable database', async () => {
    const database = await createThrowawayDatabase(await developmentAdminUrl());
    try {
      await expect(checkDatabaseConnection(database.connectionString)).resolves.toBeUndefined();
    } finally {
      await database.drop();
    }
  });
});

async function countRows(connectionString: string, table: string): Promise<number> {
  return withClient(connectionString, async (client) => {
    const result = await client.query<{ count: string }>(`select count(*) from ${table}`);
    return Number(result.rows[0]?.count);
  });
}

async function tableExists(connectionString: string, table: string): Promise<boolean> {
  return withClient(connectionString, async (client) => {
    const result = await client.query<{ exists: boolean }>(
      'select to_regclass($1) is not null as exists',
      [table],
    );
    return result.rows[0]?.exists ?? false;
  });
}

async function withClient<T>(
  connectionString: string,
  run: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}
