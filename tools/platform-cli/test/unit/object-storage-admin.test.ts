import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureBucket,
  ensureKey,
  grantBucketAccess,
  ObjectStorageAdminError,
  type ObjectStorageAdmin,
} from '../../src/object-storage/object-storage-admin.ts';

// A fake of the Garage v2 admin API, answering with the shapes and error codes measured against
// Garage v2.4.1 in build step 3.
interface FakeState {
  buckets: Map<string, string>;
  keys: Map<string, string>;
  grants: Map<string, { read: boolean; write: boolean; owner: boolean }>;
  requests: string[];
}

const TOKEN = 'test-admin-token';

function startFake(state: FakeState): Promise<Server> {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://fake');
      state.requests.push(`${request.method ?? ''} ${url.pathname}`);
      const reply = (status: number, json?: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(json === undefined ? '' : JSON.stringify(json));
      };
      if (request.headers.authorization !== `Bearer ${TOKEN}`) {
        reply(403, { code: 'AccessDenied', message: 'Forbidden' });
        return;
      }
      const input = body === '' ? {} : (JSON.parse(body) as Record<string, unknown>);
      switch (url.pathname) {
        case '/v2/GetBucketInfo': {
          const id = state.buckets.get(url.searchParams.get('globalAlias') ?? '');
          reply(id === undefined ? 404 : 200, id === undefined ? { code: 'NoSuchBucket' } : { id });
          return;
        }
        case '/v2/CreateBucket': {
          const alias = String(input.globalAlias);
          if (state.buckets.has(alias)) {
            reply(409, { code: 'BucketAlreadyExists' });
            return;
          }
          state.buckets.set(alias, `id-${alias}`);
          reply(200, { id: `id-${alias}` });
          return;
        }
        case '/v2/GetKeyInfo': {
          const secret = state.keys.get(url.searchParams.get('id') ?? '');
          reply(
            secret === undefined ? 404 : 200,
            secret === undefined ? { code: 'NoSuchAccessKey' } : { secretAccessKey: secret },
          );
          return;
        }
        case '/v2/ImportKey':
          state.keys.set(String(input.accessKeyId), String(input.secretAccessKey));
          reply(200, { accessKeyId: input.accessKeyId });
          return;
        case '/v2/AllowBucketKey':
        case '/v2/DenyBucketKey': {
          const key = `${String(input.bucketId)}/${String(input.accessKeyId)}`;
          const current = state.grants.get(key) ?? { read: false, write: false, owner: false };
          const flags = input.permissions as Record<'read' | 'write' | 'owner', boolean>;
          const allow = url.pathname === '/v2/AllowBucketKey';
          for (const flag of ['read', 'write', 'owner'] as const) {
            if (flags[flag]) {
              current[flag] = allow;
            }
          }
          state.grants.set(key, current);
          reply(200, {});
          return;
        }
        default:
          reply(404, { code: 'NotFound' });
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

describe('object storage administration (Garage admin API)', () => {
  let state: FakeState;
  let server: Server;
  let admin: ObjectStorageAdmin;

  beforeEach(async () => {
    state = { buckets: new Map(), keys: new Map(), grants: new Map(), requests: [] };
    server = await startFake(state);
    admin = {
      endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      adminToken: TOKEN,
    };
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('creates the bucket once, then finds it', async () => {
    await expect(ensureBucket(admin, 'lakehouse')).resolves.toEqual({
      id: 'id-lakehouse',
      created: true,
    });
    await expect(ensureBucket(admin, 'lakehouse')).resolves.toEqual({
      id: 'id-lakehouse',
      created: false,
    });
  });

  it('imports a key once, and refuses one the server holds with another secret', async () => {
    const key = { name: 'lakehouse-reader', accessKeyId: 'GK01', secretAccessKey: 'first' };

    await expect(ensureKey(admin, key)).resolves.toBe('created');
    await expect(ensureKey(admin, key)).resolves.toBe('existing');
    const error = await ensureKey(admin, { ...key, secretAccessKey: 'changed' }).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(ObjectStorageAdminError);
    expect((error as ObjectStorageAdminError).message).not.toContain('changed');
    expect((error as ObjectStorageAdminError).message).not.toContain('first');
    expect((error as ObjectStorageAdminError).remedy).toContain('pnpm reset:local');
  });

  it('leaves the reader read-only even if it once could write or owned the bucket', async () => {
    state.grants.set('id-lakehouse/GK02', { read: true, write: true, owner: true });

    await grantBucketAccess(admin, 'id-lakehouse', 'GK02', 'read-only');
    await grantBucketAccess(admin, 'id-lakehouse', 'GK01', 'read-write');

    expect(state.grants.get('id-lakehouse/GK02')).toEqual({
      read: true,
      write: false,
      owner: false,
    });
    expect(state.grants.get('id-lakehouse/GK01')).toEqual({
      read: true,
      write: true,
      owner: false,
    });
  });

  it('names the token as the cause of a refused request, without repeating it', async () => {
    const error = await ensureBucket({ ...admin, adminToken: 'wrong-token' }, 'lakehouse').catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(ObjectStorageAdminError);
    expect((error as ObjectStorageAdminError).remedy).toContain(
      'ATLASBI_OBJECT_STORAGE_ADMIN_TOKEN',
    );
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain('wrong-token');
  });
});
