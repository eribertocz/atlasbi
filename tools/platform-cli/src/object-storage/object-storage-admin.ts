/**
 * Administration of the "equipo local" tier's object storage server — Garage (docs/11 §4.4) —
 * through its admin API: a bearer token, no request signing. Bootstrap only: the platform itself
 * speaks nothing but S3 (the warehouse, the transformation, Cube). In the cloud tier the bucket and
 * its keys belong to OpenTofu, never to this module.
 */
export interface ObjectStorageAdmin {
  /** e.g. http://127.0.0.1:53903 */
  endpoint: string;
  adminToken: string;
}

export interface StorageKey {
  name: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export type BucketAccess = 'read-write' | 'read-only';

export class ObjectStorageAdminError extends Error {
  readonly status: number | undefined;
  /** The server's own error code (e.g. NoSuchBucket), when it sent one. */
  readonly code: string | undefined;
  readonly remedy: string | undefined;

  constructor(
    message: string,
    options: { status?: number; code?: string; remedy?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ObjectStorageAdminError';
    this.status = options.status;
    this.code = options.code;
    this.remedy = options.remedy;
  }
}

const TIMEOUT_MS = 5_000;

/** The server answers /health without a token once the node is up and has its layout. */
export async function checkObjectStorageHealth(endpoint: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    throw new ObjectStorageAdminError(
      `no answer from the object storage at ${new URL(endpoint).host}${cause ? ` (${cause})` : ''}`,
      { cause: error, remedy: 'Start the local stack with `pnpm dev`.' },
    );
  }
  if (!response.ok) {
    throw new ObjectStorageAdminError(`the object storage reports HTTP ${response.status}`, {
      status: response.status,
    });
  }
}

/** Creates the bucket unless it exists; returns its id. Safe to run on every bootstrap. */
export async function ensureBucket(
  admin: ObjectStorageAdmin,
  bucket: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await findBucket(admin, bucket);
  if (existing !== undefined) {
    return { id: existing, created: false };
  }
  try {
    const created = await call<{ id: string }>(admin, 'POST', '/v2/CreateBucket', {
      globalAlias: bucket,
    });
    return { id: created.id, created: true };
  } catch (error) {
    // Another bootstrap created it in between: the outcome is the same.
    if (error instanceof ObjectStorageAdminError && error.code === 'BucketAlreadyExists') {
      const id = await findBucket(admin, bucket);
      if (id !== undefined) {
        return { id, created: false };
      }
    }
    throw error;
  }
}

/**
 * Imports the key .env declares, unless the server already has it. A key that exists with another
 * secret is refused rather than silently kept: every S3 client would then fail with a 403 that
 * points nowhere near the cause.
 */
export async function ensureKey(
  admin: ObjectStorageAdmin,
  key: StorageKey,
): Promise<'created' | 'existing'> {
  try {
    const stored = await call<{ secretAccessKey?: string }>(
      admin,
      'GET',
      `/v2/GetKeyInfo?id=${encodeURIComponent(key.accessKeyId)}&showSecretKey=true`,
    );
    if (stored.secretAccessKey !== key.secretAccessKey) {
      throw new ObjectStorageAdminError(
        `the object storage already has the ${key.name} key (${key.accessKeyId}) with another secret`,
        {
          remedy:
            'Restore the secret it had in .env, or start the local object storage over with `pnpm reset:local`.',
        },
      );
    }
    return 'existing';
  } catch (error) {
    if (!(error instanceof ObjectStorageAdminError && error.code === 'NoSuchAccessKey')) {
      throw error;
    }
  }
  await call(admin, 'POST', '/v2/ImportKey', {
    name: key.name,
    accessKeyId: key.accessKeyId,
    secretAccessKey: key.secretAccessKey,
  });
  return 'created';
}

/**
 * Sets exactly the given access on the bucket. What the key must not have is denied explicitly —
 * a key that once owned the bucket, or could write to it, loses that here.
 */
export async function grantBucketAccess(
  admin: ObjectStorageAdmin,
  bucketId: string,
  accessKeyId: string,
  access: BucketAccess,
): Promise<void> {
  const write = access === 'read-write';
  await call(admin, 'POST', '/v2/AllowBucketKey', {
    bucketId,
    accessKeyId,
    permissions: { read: true, write, owner: false },
  });
  await call(admin, 'POST', '/v2/DenyBucketKey', {
    bucketId,
    accessKeyId,
    permissions: { read: false, write: !write, owner: true },
  });
}

async function findBucket(admin: ObjectStorageAdmin, bucket: string): Promise<string | undefined> {
  try {
    const info = await call<{ id: string }>(
      admin,
      'GET',
      `/v2/GetBucketInfo?globalAlias=${encodeURIComponent(bucket)}`,
    );
    return info.id;
  } catch (error) {
    if (error instanceof ObjectStorageAdminError && error.code === 'NoSuchBucket') {
      return undefined;
    }
    throw error;
  }
}

async function call<T = unknown>(
  admin: ObjectStorageAdmin,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${admin.endpoint}${path}`, {
      method,
      headers: { authorization: `Bearer ${admin.adminToken}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ObjectStorageAdminError(
      `no answer from the object storage admin API at ${new URL(admin.endpoint).host}`,
      { cause: error, remedy: 'Start the local stack with `pnpm dev`.' },
    );
  }
  const text = await response.text();
  if (!response.ok) {
    const failure = parseFailure(text);
    throw new ObjectStorageAdminError(
      `the object storage admin API refused ${path.split('?')[0] ?? path}: HTTP ${response.status}${failure.code ? ` ${failure.code}` : ''}`,
      {
        status: response.status,
        ...(failure.code === undefined ? {} : { code: failure.code }),
        ...(response.status === 401 || response.status === 403
          ? {
              remedy:
                'Check object-storage.admin-token (ATLASBI_OBJECT_STORAGE_ADMIN_TOKEN) in .env.',
            }
          : {}),
      },
    );
  }
  return (text === '' ? undefined : JSON.parse(text)) as T;
}

function parseFailure(text: string): { code?: string } {
  try {
    const parsed = JSON.parse(text) as { code?: unknown };
    return typeof parsed.code === 'string' ? { code: parsed.code } : {};
  } catch {
    return {};
  }
}
