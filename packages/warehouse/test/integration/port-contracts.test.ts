import {
  describeAnalyticalQueryPortContract,
  describeLakehouseAdminPortContract,
} from '@atlasbi/contracts/testing';

import { createAnalyticalQueryEngine, createLakehouseAdmin } from '../../src/index.ts';
import {
  CATALOG_TYPES,
  createTestLakehouse,
  type TestLakehouse,
} from './support/test-lakehouse.ts';

// The same batteries any future adapter must pass (docs/21 §3.3), once per supported catalog.
for (const catalogType of CATALOG_TYPES) {
  let queryLakehouse: Promise<TestLakehouse> | undefined;
  const queryFixtureLakehouse = () => (queryLakehouse ??= createTestLakehouse(catalogType));

  describeAnalyticalQueryPortContract(`DuckDB + DuckLake (${catalogType} catalog)`, {
    setup: async (statements) => {
      const admin = await createLakehouseAdmin((await queryFixtureLakehouse()).settings);
      try {
        for (const statement of statements) {
          await admin.execute(statement);
        }
      } finally {
        await admin.close();
      }
    },
    openPort: async () => createAnalyticalQueryEngine((await queryFixtureLakehouse()).settings),
    dispose: async () => (await queryFixtureLakehouse()).dispose(),
  });

  let adminLakehouse: Promise<TestLakehouse> | undefined;
  const adminFixtureLakehouse = () => (adminLakehouse ??= createTestLakehouse(catalogType));

  describeLakehouseAdminPortContract(`DuckDB + DuckLake (${catalogType} catalog)`, {
    openAdmin: async () => createLakehouseAdmin((await adminFixtureLakehouse()).settings),
    openQueryPort: async () =>
      createAnalyticalQueryEngine((await adminFixtureLakehouse()).settings),
    dispose: async () => (await adminFixtureLakehouse()).dispose(),
  });
}
