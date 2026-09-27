import {
  checkObjectStorageHealth,
  ensureBucket,
  ensureKey,
  grantBucketAccess,
  type ObjectStorageAdmin,
  type StorageKey,
} from '../object-storage/object-storage-admin.ts';
import { describeFailure } from '../lakehouse-environment.ts';
import type { ReadinessStep } from './readiness-chain.ts';
import { retryUntil, type RetryPolicy } from './retry-until.ts';

export const OBJECT_STORAGE_STEP = 'Object storage';

// A first start lays out the single node; it answers /health within seconds.
const OBJECT_STORAGE_READY: RetryPolicy = { timeoutMs: 60_000, intervalMs: 1_000 };

/** What bootstrap sets up on the local object storage: the bucket and the two lakehouse keys. */
export interface ObjectStorageProvisioning {
  admin: ObjectStorageAdmin;
  bucket: string;
  writer: StorageKey;
  reader: StorageKey;
}

/**
 * dev: the local object storage answers. bootstrap: also the lakehouse's bucket, the writer key
 * (read-write) and the reader key (read-only) — idempotent, the admin API is the only way in.
 */
export function objectStorageReadinessSteps(
  adminEndpoint: string,
  provisioning: ObjectStorageProvisioning | undefined,
): ReadinessStep[] {
  return [
    {
      name: OBJECT_STORAGE_STEP,
      ensureReady: async () => {
        try {
          await retryUntil(() => checkObjectStorageHealth(adminEndpoint), OBJECT_STORAGE_READY);
          if (provisioning === undefined) {
            return 'healthy';
          }
          const { admin, bucket, writer, reader } = provisioning;
          const { id } = await ensureBucket(admin, bucket);
          await ensureKey(admin, writer);
          await grantBucketAccess(admin, id, writer.accessKeyId, 'read-write');
          await ensureKey(admin, reader);
          await grantBucketAccess(admin, id, reader.accessKeyId, 'read-only');
          return `healthy — bucket ${bucket}; writer key read-write, reader key read-only`;
        } catch (error) {
          throw new Error(describeFailure(error), { cause: error });
        }
      },
    },
  ];
}
