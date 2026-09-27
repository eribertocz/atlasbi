import type { LakehouseCatalogType } from '@atlasbi/contracts';
import { ensureDatabaseExists, ensureReadOnlyRole } from '@atlasbi/database';
import {
  createAnalyticalQueryEngine,
  createLakehouseAdmin,
  describeCatalogType,
  describeStorageKind,
  installLakehouseExtensions,
  provisionLakehouse,
  type ExtensionStatus,
  type LakehouseSettings,
  type LakehouseStorageKind,
} from '@atlasbi/warehouse';

import { describeFailure } from '../lakehouse-environment.ts';
import { OBJECT_STORAGE_STEP } from './object-storage-probes.ts';
import type { ReadinessStep } from './readiness-chain.ts';

export type LakehouseStartMode = 'bootstrap' | 'dev';

const EXTENSIONS_STEP = 'DuckDB extensions';
const SINGLE_WRITER_NOTE = 'single-writer mode — recommended for individual development';

/** The readiness line: catalog and storage — SQLite always carries its single-writer note. */
export function lakehouseReadinessDetail(
  catalogType: LakehouseCatalogType,
  storageKind: LakehouseStorageKind,
): string {
  const catalog = describeCatalogType(catalogType);
  const note = catalogType === 'sqlite' ? ` (${SINGLE_WRITER_NOTE})` : '';
  return `healthy — Catalog: ${catalog}${note} · Storage: ${describeStorageKind(storageKind)}`;
}

export function describeExtensions(statuses: readonly ExtensionStatus[]): string {
  return statuses
    .map((status) =>
      status.state === 'ready'
        ? `${status.name} ${status.version ?? ''}`.trim()
        : `${status.name} (${status.state})`,
    )
    .join(', ');
}

export interface LakehouseAccess {
  /** Catalog owner and the storage key that writes: admin port, provisioning. */
  writer: LakehouseSettings;
  /** SELECT-only catalog role and read-only storage key: the query port. */
  reader: LakehouseSettings;
}

/** Bootstrap sets the reader's catalog role up; it needs a connection that may create roles. */
export interface ReaderRoleSetup {
  adminConnectionString: string;
  readerConnectionString: string;
}

/**
 * bootstrap: catalog database → extensions (the only download) → provisioning → reader role →
 * verification. dev: verification only — the runtime never installs, downloads or creates anything.
 */
export function lakehouseReadinessSteps(
  access: LakehouseAccess,
  mode: LakehouseStartMode,
  readerRole?: ReaderRoleSetup,
): ReadinessStep[] {
  const { writer } = access;
  const steps: ReadinessStep[] = [];
  if (mode === 'bootstrap') {
    steps.push({
      name: EXTENSIONS_STEP,
      ensureReady: async () => {
        const statuses = await installLakehouseExtensions(writer.extensionDirectory);
        if (statuses.some((status) => status.state !== 'ready')) {
          throw new Error(`not usable after installing: ${describeExtensions(statuses)}`);
        }
        return describeExtensions(statuses);
      },
    });
  }
  steps.push({
    name: 'Lakehouse',
    dependsOn: [
      ...(writer.catalog.type === 'postgres' ? ['Postgres'] : []),
      ...(writer.storage.kind === 's3' ? [OBJECT_STORAGE_STEP] : []),
      ...(mode === 'bootstrap' ? [EXTENSIONS_STEP] : []),
    ],
    ensureReady: async () => {
      try {
        if (mode === 'bootstrap') {
          await provision(writer, readerRole);
        }
        await verifyLakehouse(access);
        return lakehouseReadinessDetail(writer.catalog.type, writer.storage.kind);
      } catch (error) {
        throw new Error(describeFailure(error), { cause: error });
      }
    },
  });
  return steps;
}

async function provision(writer: LakehouseSettings, readerRole?: ReaderRoleSetup): Promise<void> {
  if (writer.catalog.type === 'postgres') {
    await ensureDatabaseExists(writer.catalog.connectionString);
  }
  await provisionLakehouse(writer);
  if (writer.catalog.type === 'postgres') {
    if (readerRole === undefined) {
      throw new Error('the PostgreSQL tier needs its reader role set up during bootstrap');
    }
    await ensureReadOnlyRole({
      ...readerRole,
      owner: decodeURIComponent(new URL(writer.catalog.connectionString).username),
    });
  }
}

/**
 * The admin port reports health as the writer; the query port proves the reader works end to end
 * — its catalog role and its storage key — by reading a real value. A `count(*)` would not do:
 * DuckLake answers it from the catalog's statistics without touching the storage.
 */
async function verifyLakehouse({ writer, reader }: LakehouseAccess): Promise<void> {
  const admin = await createLakehouseAdmin(writer);
  let lakehouseId: string;
  try {
    lakehouseId = (await admin.checkHealth()).lakehouseId;
  } finally {
    await admin.close();
  }
  const port = await createAnalyticalQueryEngine(reader);
  try {
    const result = await port.query('SELECT lakehouse_id FROM lake.platform.lakehouse_identity');
    if (result.rows[0]?.[0] !== lakehouseId) {
      throw new Error('the reader sees another lakehouse than the writer');
    }
  } finally {
    await port.close();
  }
}
