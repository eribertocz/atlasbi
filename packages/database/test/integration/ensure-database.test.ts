import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseUnavailableError, ensureDatabaseExists } from '../../src/index.ts';
import { developmentAdminUrl } from './support/development-admin-url.ts';

describe('ensureDatabaseExists against a real Postgres', () => {
  const created: string[] = [];

  afterEach(async () => {
    const admin = new pg.Client({ connectionString: await developmentAdminUrl() });
    await admin.connect();
    try {
      for (const name of created.splice(0)) {
        await admin.query(`drop database if exists ${name} with (force)`);
      }
    } finally {
      await admin.end();
    }
  });

  it('creates the database named in the URL once, then reports it as existing', async () => {
    const name = `atlasbi_test_${randomUUID().replaceAll('-', '')}`;
    created.push(name);
    const url = new URL(await developmentAdminUrl());
    url.pathname = `/${name}`;

    await expect(ensureDatabaseExists(url.toString())).resolves.toBe('created');
    await expect(ensureDatabaseExists(url.toString())).resolves.toBe('existing');
  });

  it('fails fast, without retrying, when the password is wrong', async () => {
    const url = new URL(await developmentAdminUrl());
    url.password = 'wrong-password';
    url.pathname = '/lakehouse_never_created';

    const error: unknown = await ensureDatabaseExists(url.toString()).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect((error as DatabaseUnavailableError).retryable).toBe(false);
    expect((error as Error).message).not.toContain('wrong-password');
  });
});
