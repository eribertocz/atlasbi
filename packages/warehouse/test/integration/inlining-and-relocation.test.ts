import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { expectLakehouseError } from '@atlasbi/contracts/testing';
import { describe, expect, it } from 'vitest';

import {
  createAnalyticalQueryEngine,
  createLakehouseAdmin,
  INLINING_POLICY,
  provisionLakehouse,
  type LakehouseSettings,
} from '../../src/index.ts';
import { CATALOG_TYPES, createTestLakehouse, removeFolder } from './support/test-lakehouse.ts';

const SUMMARY = 'SELECT count(*), sum(id), min(id), max(id) FROM lake.main.events';

async function summarize(settings: LakehouseSettings) {
  const port = await createAnalyticalQueryEngine(settings);
  try {
    return (await port.query(SUMMARY)).rows;
  } finally {
    await port.close();
  }
}

for (const catalogType of CATALOG_TYPES) {
  describe(`Inlining v1 (${catalogType} catalog)`, () => {
    it('is persisted at provisioning, idempotently, and beats any client setting', async () => {
      const lakehouse = await createTestLakehouse(catalogType);
      try {
        const again = await provisionLakehouse(lakehouse.settings);
        expect(again).toMatchObject({ catalogFormatVersion: '1.0', inliningPolicyApplied: false });

        const admin = await createLakehouseAdmin(lakehouse.settings);
        try {
          // A client that turned inlining off for itself still obeys the persisted limit.
          await admin.execute('SET GLOBAL ducklake_default_data_inlining_row_limit = 0');
          await admin.execute('CREATE TABLE lake.main.small (id BIGINT)');
          await admin.execute('INSERT INTO lake.main.small VALUES (1), (2)');

          const health = await admin.checkHealth();
          expect(health.inlining).toEqual({
            rowLimit: INLINING_POLICY.rowLimit,
            pendingRows: '2',
          });
        } finally {
          await admin.close();
        }
      } finally {
        await lakehouse.dispose();
      }
    });

    it('serves inlined rows to a read-only port before any flush', async () => {
      const lakehouse = await createTestLakehouse(catalogType);
      try {
        const admin = await createLakehouseAdmin(lakehouse.settings);
        try {
          await admin.execute('CREATE TABLE lake.main.events (id BIGINT)');
          await admin.execute('INSERT INTO lake.main.events SELECT range FROM range(100)');
          await admin.execute('INSERT INTO lake.main.events VALUES (1000), (1001)');
          expect((await admin.checkHealth()).inlining.pendingRows).toBe('2');
        } finally {
          await admin.close();
        }

        expect(await summarize(lakehouse.settings)).toEqual([['102', '6951', '0', '1001']]);
      } finally {
        await lakehouse.dispose();
      }
    });
  });

  describe(`relocation (${catalogType} catalog)`, () => {
    it('reads a copied lakehouse only when overriding the data path explicitly', async () => {
      const lakehouse = await createTestLakehouse(catalogType);
      try {
        const admin = await createLakehouseAdmin(lakehouse.settings);
        try {
          await admin.execute('CREATE TABLE lake.main.events (id BIGINT)');
          await admin.execute('INSERT INTO lake.main.events SELECT range FROM range(100)');
          await admin.execute('INSERT INTO lake.main.events VALUES (1000), (1001)');
        } finally {
          await admin.close();
        }
        const original = await summarize(lakehouse.settings);

        const copyRoot = path.join(lakehouse.root, 'copy');
        await mkdir(copyRoot, { recursive: true });
        await cp(lakehouse.settings.dataPath, path.join(copyRoot, 'files'), { recursive: true });
        let copied: LakehouseSettings = {
          ...lakehouse.settings,
          dataPath: path.join(copyRoot, 'files'),
        };
        if (lakehouse.settings.catalog.type === 'sqlite') {
          const catalogCopy = path.join(copyRoot, 'catalog.sqlite');
          await cp(lakehouse.settings.catalog.path, catalogCopy);
          copied = { ...copied, catalog: { type: 'sqlite', path: catalogCopy } };
        }
        // The copy must be what is read: the original data files are gone.
        await removeFolder(lakehouse.settings.dataPath);

        await expectLakehouseError(createAnalyticalQueryEngine(copied), 'data_path_mismatch');
        expect(await summarize({ ...copied, overrideDataPath: true })).toEqual(original);
      } finally {
        await lakehouse.dispose();
      }
    });
  });
}
