import type { LakehouseSettings } from '@atlasbi/warehouse';
import { createTestLakehouse, type TestLakehouse } from '@atlasbi/warehouse/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { probeSemanticLayer } from '../../src/index.ts';
import { startCubeStack, type CubeStack } from './support/cube-stack.ts';
import { writeSalesMart } from './support/sales-mart.ts';

// What Cube tells clients about any lakehouse failure (cube/lakehouse-connection.cjs).
const CLIENT_MESSAGE =
  /The lakehouse is unavailable to the semantic layer; the details are in the Cube logs\./;
// Anything a client must never learn about the platform's insides.
const INTERNALS =
  /postgres|object-storage|lakehouse_reader|55432|5432|3900|\b\d{1,3}(\.\d{1,3}){3}\b/;

let lakehouse: TestLakehouse | undefined;
let cube: CubeStack | undefined;

beforeAll(async () => {
  lakehouse = await createTestLakehouse('postgres');
  await writeSalesMart(lakehouse.settings);
});

afterEach(async () => {
  await cube?.stop();
  cube = undefined;
});

afterAll(async () => {
  await lakehouse?.dispose();
});

function reader(): LakehouseSettings {
  if (!lakehouse) {
    throw new Error('no test lakehouse');
  }
  return lakehouse.readerSettings;
}

describe('Cube when the lakehouse is out of reach', () => {
  it('with a wrong catalog password: /readyz is down, clients get a generic error, the logs keep the password out', async () => {
    const password = 'not-the-reader-password';
    const catalog = reader().catalog;
    if (catalog.type !== 'postgres') {
      throw new Error('Cube reads the postgres tier only');
    }
    const url = new URL(catalog.connectionString);
    url.password = password;
    cube = await startCubeStack({
      ...reader(),
      catalog: { ...catalog, connectionString: url.toString() },
    });

    const response = await cube.load({ dimensions: ['regions.zone'], limit: 1 });

    expect(await cube.readyzStatus()).toBe(500);
    expect(response.error).toMatch(CLIENT_MESSAGE);
    expect(response.error).not.toMatch(INTERNALS);
    const logs = await cube.logs();
    expect(logs).toMatch(/password authentication failed/);
    expect(logs).not.toContain(password);
  });

  it('with a wrong storage secret: /readyz still says ready — only a query that reads data notices', async () => {
    const secret = 'not-the-reader-secret';
    const storage = reader().storage;
    if (storage.kind !== 's3') {
      throw new Error('Cube reads the postgres tier only');
    }
    cube = await startCubeStack({ ...reader(), storage: { ...storage, secretAccessKey: secret } });

    // Why readiness reads a column (build step 3, Phase 0): the catalog answers, the data does not.
    expect(await cube.readyzStatus()).toBe(200);
    const failure = await probeSemanticLayer({
      url: cube.restUrl,
      apiSecret: cube.apiSecret,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toMatch(/cannot answer from the lakehouse/);
    expect(message).toMatch(CLIENT_MESSAGE);
    expect(message).not.toMatch(INTERNALS);
    expect(await cube.logs()).not.toContain(secret);
  });
});
