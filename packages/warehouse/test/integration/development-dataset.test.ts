import { describe, expect, it } from 'vitest';

import {
  createAnalyticalQueryEngine,
  createLakehouseAdmin,
  DEVELOPMENT_DATASET,
  seedDevelopmentDataset,
} from '../../src/index.ts';
import { CATALOG_TYPES, createTestLakehouse } from './support/test-lakehouse.ts';

const FINGERPRINT = `SELECT count(*), sum(amount), min(order_date), max(order_date),
  count(DISTINCT region), count(DISTINCT customer_id) FROM ${DEVELOPMENT_DATASET.table}`;

describe('development dataset (pnpm seed)', () => {
  it('is deterministic and idempotent, identical on both catalogs, with nothing left pending', async () => {
    const fingerprints = [];
    for (const catalogType of CATALOG_TYPES) {
      const lakehouse = await createTestLakehouse(catalogType);
      try {
        const admin = await createLakehouseAdmin(lakehouse.settings);
        try {
          const first = await seedDevelopmentDataset(admin);
          const second = await seedDevelopmentDataset(admin);
          expect(first).toEqual({
            table: DEVELOPMENT_DATASET.table,
            rows: String(DEVELOPMENT_DATASET.rowCount),
            rowsFlushed: '0',
          });
          expect(second).toEqual(first);
          expect((await admin.checkHealth()).inlining.pendingRows).toBe('0');
        } finally {
          await admin.close();
        }
        const port = await createAnalyticalQueryEngine(lakehouse.settings);
        try {
          fingerprints.push((await port.query(FINGERPRINT)).rows);
        } finally {
          await port.close();
        }
      } finally {
        await lakehouse.dispose();
      }
    }

    expect(fingerprints[0]?.[0]?.[0]).toBe('20000');
    expect(fingerprints[0]?.[0]?.[4]).toBe('5');
    expect(fingerprints[1]).toEqual(fingerprints[0]);
  });
});
