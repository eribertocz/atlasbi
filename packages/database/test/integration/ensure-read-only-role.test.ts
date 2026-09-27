import { randomBytes } from 'node:crypto';

import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureReadOnlyRole } from '../../src/index.ts';
import { createThrowawayDatabase, type ThrowawayDatabase } from '../../src/testing/index.ts';
import { developmentAdminUrl } from './support/development-admin-url.ts';

async function withClient<T>(connectionString: string, work: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

describe('ensureReadOnlyRole against a real Postgres', () => {
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  async function setUp(): Promise<{
    database: ThrowawayDatabase;
    readerUrl: string;
    role: string;
  }> {
    const adminUrl = await developmentAdminUrl();
    const database = await createThrowawayDatabase(adminUrl);
    const role = `atlasbi_test_role_${randomBytes(6).toString('hex')}`;
    cleanups.push(() =>
      withClient(adminUrl, async (client) => {
        await client.query(`drop role if exists ${role}`);
      }),
    );
    cleanups.push(() => database.drop());
    await withClient(database.connectionString, (client) =>
      client.query(
        'create table existing_table (id integer); insert into existing_table values (1)',
      ),
    );
    const readerUrl = new URL(database.connectionString);
    readerUrl.username = role;
    readerUrl.password = `pw-${randomBytes(8).toString('hex')}`;
    return { database, readerUrl: readerUrl.toString(), role };
  }

  it('reads today and tomorrow’s tables, and can change nothing', async () => {
    const { database, readerUrl } = await setUp();
    const owner = decodeURIComponent(new URL(database.connectionString).username);

    await expect(
      ensureReadOnlyRole({
        adminConnectionString: await developmentAdminUrl(),
        readerConnectionString: readerUrl,
        owner,
      }),
    ).resolves.toBe('created');
    // A table the owner creates after the grant (DuckLake does, e.g. for inlined data).
    await withClient(database.connectionString, (client) =>
      client.query('create table later_table (id integer); insert into later_table values (2)'),
    );

    await withClient(readerUrl, async (client) => {
      await expect(client.query('select id from existing_table')).resolves.toMatchObject({
        rows: [{ id: 1 }],
      });
      await expect(client.query('select id from later_table')).resolves.toMatchObject({
        rows: [{ id: 2 }],
      });
      await expect(client.query('insert into existing_table values (3)')).rejects.toThrow(
        /permission denied/,
      );
      await expect(client.query('create table intruder (id integer)')).rejects.toThrow(
        /permission denied/,
      );
      await expect(client.query('drop table existing_table')).rejects.toThrow(/must be owner/);
    });
  });

  it('is idempotent, and the password follows the secret', async () => {
    const { database, readerUrl } = await setUp();
    const adminConnectionString = await developmentAdminUrl();
    const owner = decodeURIComponent(new URL(database.connectionString).username);
    await ensureReadOnlyRole({ adminConnectionString, readerConnectionString: readerUrl, owner });
    const rotated = new URL(readerUrl);
    rotated.password = `pw-${randomBytes(8).toString('hex')}`;

    await expect(
      ensureReadOnlyRole({
        adminConnectionString,
        readerConnectionString: rotated.toString(),
        owner,
      }),
    ).resolves.toBe('existing');

    await expect(
      withClient(rotated.toString(), (client) => client.query('select 1')),
    ).resolves.toBeDefined();
    await expect(withClient(readerUrl, (client) => client.query('select 1'))).rejects.toThrow(
      /password authentication failed/,
    );
  });

  // Found by the warehouse suites running in parallel: without serialization, concurrent callers
  // raced on the server-wide role ("tuple concurrently updated").
  it('survives many callers at once for the same role', async () => {
    const { database, readerUrl } = await setUp();
    const adminConnectionString = await developmentAdminUrl();
    const owner = decodeURIComponent(new URL(database.connectionString).username);

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        ensureReadOnlyRole({ adminConnectionString, readerConnectionString: readerUrl, owner }),
      ),
    );

    expect(outcomes.filter((outcome) => outcome === 'created')).toHaveLength(1);
    await expect(
      withClient(readerUrl, (client) => client.query('select id from existing_table')),
    ).resolves.toMatchObject({ rows: [{ id: 1 }] });
  });

  it('refuses names that are not plain identifiers, before touching the server', async () => {
    const readerUrl = 'postgres://Robert%27%29%3B:pw@127.0.0.1:1/lakehouse';

    await expect(
      ensureReadOnlyRole({
        adminConnectionString: await developmentAdminUrl(),
        readerConnectionString: readerUrl,
        owner: 'atlasbi',
      }),
    ).rejects.toThrow(/not a plain lowercase identifier/);
  });
});
