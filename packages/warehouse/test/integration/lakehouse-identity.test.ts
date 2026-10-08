import { mkdir } from 'node:fs/promises';

import { expectLakehouseError } from '@atlasbi/contracts-testing';
import { describe, expect, it } from 'vitest';

import {
  createLakehouseAdmin,
  provisionLakehouse,
  type LakehouseSettings,
} from '../../src/index.ts';
import { CATALOG_TYPES, createTestLakehouse, removeFolder } from './support/test-lakehouse.ts';

async function identityOf(settings: LakehouseSettings): Promise<string> {
  const admin = await createLakehouseAdmin(settings);
  try {
    return (await admin.checkHealth()).lakehouseId;
  } finally {
    await admin.close();
  }
}

for (const catalogType of CATALOG_TYPES) {
  describe(`lakehouse identity (${catalogType} catalog)`, () => {
    it('is assigned once at provisioning and kept by every later provisioning', async () => {
      const lakehouse = await createTestLakehouse(catalogType);
      try {
        const first = await identityOf(lakehouse.settings);
        const again = await provisionLakehouse(lakehouse.settings);

        expect(again).toMatchObject({ lakehouseId: first, identityCreated: false });
        expect(await identityOf(lakehouse.settings)).toBe(first);
      } finally {
        await lakehouse.dispose();
      }
    });

    it('is new for every lakehouse, and leaves no inlined row pending', async () => {
      const [a, b] = await Promise.all([
        createTestLakehouse(catalogType),
        createTestLakehouse(catalogType),
      ]);
      try {
        expect(await identityOf(a.settings)).not.toBe(await identityOf(b.settings));
        const admin = await createLakehouseAdmin(a.settings);
        try {
          expect((await admin.checkHealth()).inlining.pendingRows).toBe('0');
        } finally {
          await admin.close();
        }
      } finally {
        await Promise.all([a.dispose(), b.dispose()]);
      }
    });

    it('asks to provision again when the identity record is missing, and provisioning restores one', async () => {
      const lakehouse = await createTestLakehouse(catalogType);
      try {
        const before = await identityOf(lakehouse.settings);
        const admin = await createLakehouseAdmin(lakehouse.settings);
        try {
          await admin.execute('DROP TABLE lake.platform.lakehouse_identity');
          const error = await expectLakehouseError(admin.checkHealth(), 'catalog_unreachable');
          expect(error.remedy).toContain('pnpm bootstrap');
        } finally {
          await admin.close();
        }

        const restored = await provisionLakehouse(lakehouse.settings);

        expect(restored.identityCreated).toBe(true);
        expect(restored.lakehouseId).not.toBe(before);
      } finally {
        await lakehouse.dispose();
      }
    });
  });
}

// What `pnpm reset:local` followed by `pnpm bootstrap` does: the same location, a new lakehouse.
describe('a lakehouse created again at the same location', () => {
  it('gets a new identity (SQLite catalog: same file path, same data folder)', async () => {
    const lakehouse = await createTestLakehouse('sqlite');
    try {
      const before = await identityOf(lakehouse.settings);

      await removeFolder(lakehouse.root);
      await mkdir(lakehouse.root, { recursive: true });
      const recreated = await provisionLakehouse(lakehouse.settings);

      expect(recreated.identityCreated).toBe(true);
      expect(recreated.lakehouseId).not.toBe(before);
    } finally {
      await lakehouse.dispose();
    }
  });
});
