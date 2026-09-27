import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { LakehouseError, type LakehouseCatalogType } from '@atlasbi/contracts';

import { resolveLakehouseLocation } from '../../lakehouse-location.ts';
import { INLINING_POLICY, SUPPORTED_CATALOG_FORMAT } from '../../lakehouse-policies.ts';
import type { LakehouseSettings } from '../../lakehouse-settings.ts';
import { LAKE_ALIAS } from './attach-statement.ts';
import { readRows, scalarText } from './internal-reads.ts';
import { LakehouseEngine } from './lakehouse-engine.ts';
import { ensureLakehouseIdentity } from './lakehouse-identity.ts';
import { quoteLiteral } from './sql-literals.ts';
import type { TelemetryProviders } from './telemetry.ts';

export interface ProvisionResult {
  /** The lakehouse's identity (a UUID): kept if it already had one, created otherwise. */
  lakehouseId: string;
  identityCreated: boolean;
  catalogType: LakehouseCatalogType;
  catalogFormatVersion: string;
  /** False when the catalog already carried the Inlining v1 row limit. */
  inliningPolicyApplied: boolean;
}

/**
 * The only path that may create a lakehouse (CREATE_IF_NOT_EXISTS), run by bootstrap alone.
 * Idempotent: on an existing lakehouse it only re-asserts the inlining policy and keeps its
 * identity (a lakehouse provisioned before identities existed gets one here). The data path is
 * still checked strictly, so pointing at the wrong folder fails instead of creating a second lake.
 */
export async function provisionLakehouse(
  settings: LakehouseSettings,
  telemetry: TelemetryProviders = {},
): Promise<ProvisionResult> {
  const location = resolveLakehouseLocation(settings);
  // S3 needs no folder: the first data file written (the identity, below) proves the bucket is
  // there and the key may write to it.
  if (location.storageKind === 'folder') {
    await createFolder(location.dataPath);
  }
  if (location.sqliteCatalogPath !== undefined) {
    await createFolder(path.dirname(location.sqliteCatalogPath));
  }

  const engine = await LakehouseEngine.open(settings, 'provision', telemetry);
  try {
    const format = await readOption(engine, 'version');
    if (format !== SUPPORTED_CATALOG_FORMAT) {
      throw new LakehouseError(
        'catalog_format_mismatch',
        `The lakehouse catalog format is ${format ?? 'unknown'}; this platform reads and writes ${SUPPORTED_CATALOG_FORMAT}.`,
      );
    }
    const limit = await readOption(engine, 'data_inlining_row_limit');
    const applyPolicy = limit !== String(INLINING_POLICY.rowLimit);
    if (applyPolicy) {
      const statement = `CALL ${LAKE_ALIAS}.set_option('data_inlining_row_limit', ${INLINING_POLICY.rowLimit})`;
      await engine.run(statement, (connection) => connection.run(statement));
    }
    const identity = await ensureLakehouseIdentity(engine);
    return {
      lakehouseId: identity.lakehouseId,
      identityCreated: identity.created,
      catalogType: settings.catalog.type,
      catalogFormatVersion: format,
      inliningPolicyApplied: applyPolicy,
    };
  } finally {
    await engine.close();
  }
}

async function readOption(engine: LakehouseEngine, name: string): Promise<string | undefined> {
  const statement = `SELECT value FROM ${LAKE_ALIAS}.options() WHERE option_name = ${quoteLiteral(name)} AND scope = 'GLOBAL'`;
  return engine.run(statement, async (connection) => {
    const [row] = await readRows(connection, statement);
    return scalarText(row?.value);
  });
}

async function createFolder(folder: string): Promise<void> {
  try {
    await mkdir(folder, { recursive: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';
    throw new Error(`Cannot create the lakehouse folder ${folder} (${code}).`, { cause: error });
  }
}
