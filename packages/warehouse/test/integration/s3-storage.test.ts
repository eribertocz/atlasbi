import { randomUUID } from 'node:crypto';

import { expectLakehouseError } from '@atlasbi/contracts-testing';
import { createThrowawayDatabase } from '@atlasbi/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createAnalyticalQueryEngine,
  createLakehouseAdmin,
  provisionLakehouse,
  type LakehouseSettings,
} from '../../src/index.ts';
import {
  createTestLakehouse,
  developmentAdminUrl,
  installedExtensionDirectory,
  testS3Storage,
  type TestLakehouse,
} from './support/test-lakehouse.ts';

const WRONG_SECRET = `wrong-secret-${'x'.repeat(24)}`;

function withStorage(
  settings: LakehouseSettings,
  change: Partial<Extract<LakehouseSettings['storage'], { kind: 's3' }>>,
): LakehouseSettings {
  if (settings.storage.kind !== 's3') {
    throw new Error('only for S3 storage');
  }
  return { ...settings, storage: { ...settings.storage, ...change } };
}

// Object storage failures of the postgres tier (build step 3), each reported as
// storage_unreachable with a remedy — never as a catalog problem, never with a credential.
describe('lakehouse data files on S3', () => {
  let lakehouse: TestLakehouse;

  beforeAll(async () => {
    lakehouse = await createTestLakehouse('postgres');
    const admin = await createLakehouseAdmin(lakehouse.settings);
    try {
      await admin.execute('CREATE TABLE lake.main.facts AS SELECT range AS id FROM range(500)');
    } finally {
      await admin.close();
    }
  });

  afterAll(async () => {
    await lakehouse.dispose();
  });

  it('keeps every data file under the lakehouse prefix, readable by the reader', async () => {
    const files = await lakehouse.listDataFiles();
    const port = await createAnalyticalQueryEngine(lakehouse.readerSettings);
    try {
      expect(files.some((file) => file.startsWith('main/facts/'))).toBe(true);
      expect(files.some((file) => file.startsWith('platform/lakehouse_identity/'))).toBe(true);
      await expect(port.query('SELECT sum(id) FROM lake.main.facts')).resolves.toMatchObject({
        rows: [['124750']],
      });
    } finally {
      await port.close();
    }
  });

  it('reports a wrong secret as storage_unreachable — health reads a value, so it notices', async () => {
    const admin = await createLakehouseAdmin(
      withStorage(lakehouse.settings, { secretAccessKey: WRONG_SECRET }),
    );
    try {
      const error = await expectLakehouseError(admin.checkHealth(), 'storage_unreachable');

      expect(error.message).toContain('the secret key does not match the access key');
      expect(`${error.message} ${error.remedy ?? ''}`).not.toContain(WRONG_SECRET);
    } finally {
      await admin.close();
    }
  });

  it('answers count(*) from the catalog statistics, so only a value read proves the key works', async () => {
    const port = await createAnalyticalQueryEngine(
      withStorage(lakehouse.readerSettings, { secretAccessKey: WRONG_SECRET }),
    );
    try {
      await expect(port.query('SELECT count(*) FROM lake.main.facts')).resolves.toMatchObject({
        rows: [['500']],
      });
      await expectLakehouseError(
        port.query('SELECT sum(id) FROM lake.main.facts'),
        'storage_unreachable',
      );
    } finally {
      await port.close();
    }
  });

  it('reports an object storage that does not answer as storage_unreachable, retryable', async () => {
    const port = await createAnalyticalQueryEngine(
      withStorage(lakehouse.readerSettings, { endpoint: '127.0.0.1:1' }),
    );
    try {
      const error = await expectLakehouseError(
        port.query('SELECT sum(id) FROM lake.main.facts'),
        'storage_unreachable',
      );

      expect(error.retryable).toBe(true);
      expect(error.message).toBe('Cannot reach the lakehouse object storage at 127.0.0.1:1.');
    } finally {
      await port.close();
    }
  });
});

describe('provisioning on S3', () => {
  it('refuses a bucket that does not exist, with the remedy', async () => {
    const database = await createThrowawayDatabase(await developmentAdminUrl());
    try {
      const storage = await testS3Storage('writer', `tests/${randomUUID()}/`);
      const settings: LakehouseSettings = {
        catalog: { type: 'postgres', connectionString: database.connectionString },
        storage: { ...storage, url: `s3://no-such-bucket-atlasbi/${randomUUID()}/` },
        extensionDirectory: await installedExtensionDirectory(),
      };

      const error = await expectLakehouseError(provisionLakehouse(settings), 'storage_unreachable');

      expect(error.message).toBe("The lakehouse's bucket does not exist on the object storage.");
      expect(error.remedy).toContain('ATLASBI_LAKEHOUSE_S3_URL');
    } finally {
      await database.drop();
    }
  });
});
