import { constants, existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';

import type { EnvironmentVariables } from '@atlasbi/config';
import { z } from 'zod';

import { WORKSPACE_FILES } from './workspace-paths.ts';

export class MissingEnvFileError extends Error {
  constructor() {
    super('.env does not exist yet. Run `pnpm bootstrap` once to create it from .env.example.');
    this.name = 'MissingEnvFileError';
  }
}

export function hasEnvFile(): boolean {
  return existsSync(WORKSPACE_FILES.envFile);
}

/** Loads .env into process.env; variables already set in the shell keep precedence. */
export function loadEnvFile(): void {
  if (!hasEnvFile()) {
    throw new MissingEnvFileError();
  }
  process.loadEnvFile(WORKSPACE_FILES.envFile);
}

/** Creates .env from .env.example; never overwrites an existing .env. */
export async function ensureEnvFile(): Promise<'created' | 'existing'> {
  try {
    await copyFile(
      WORKSPACE_FILES.envExampleFile,
      WORKSPACE_FILES.envFile,
      constants.COPYFILE_EXCL,
    );
    return 'created';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return 'existing';
    }
    throw error;
  }
}

const portSchema = z.coerce.number().int().min(1).max(65535);

const localInfraSchema = z.object({
  ATLASBI_POSTGRES_PORT: portSchema.default(55432),
  ATLASBI_OTEL_GRPC_PORT: portSchema.default(4317),
  ATLASBI_OTEL_HTTP_PORT: portSchema.default(4318),
  ATLASBI_OTEL_HEALTH_PORT: portSchema.default(13133),
  ATLASBI_OBJECT_STORAGE_PORT: portSchema.default(53900),
  ATLASBI_OBJECT_STORAGE_ADMIN_PORT: portSchema.default(53903),
  ATLASBI_CUBE_PORT: portSchema.default(4000),
  ATLASBI_CUBE_SQL_PORT: portSchema.default(15432),
});

export interface LocalInfraPorts {
  postgres: number;
  otelGrpc: number;
  otelHttp: number;
  otelHealth: number;
  objectStorage: number;
  objectStorageAdmin: number;
  cube: number;
  cubeSql: number;
}

/** Host ports published by compose.yaml, keyed the same way the compose services use them. */
export function readLocalInfraPorts(env: EnvironmentVariables = process.env): LocalInfraPorts {
  const values = localInfraSchema.parse(
    Object.fromEntries(Object.entries(env).filter(([, value]) => value !== '')),
  );
  return {
    postgres: values.ATLASBI_POSTGRES_PORT,
    otelGrpc: values.ATLASBI_OTEL_GRPC_PORT,
    otelHttp: values.ATLASBI_OTEL_HTTP_PORT,
    otelHealth: values.ATLASBI_OTEL_HEALTH_PORT,
    objectStorage: values.ATLASBI_OBJECT_STORAGE_PORT,
    objectStorageAdmin: values.ATLASBI_OBJECT_STORAGE_ADMIN_PORT,
    cube: values.ATLASBI_CUBE_PORT,
    cubeSql: values.ATLASBI_CUBE_SQL_PORT,
  };
}

/** Every service of compose.yaml: the local tier (postgres catalog, S3 storage, Cube). */
export const LOCAL_TIER_SERVICES = [
  'postgres',
  'otel-collector',
  'object-storage',
  'cube-store',
  'cube',
] as const;

/** The portable tier (sqlite catalog, folder storage) has neither object storage nor Cube. */
export const PORTABLE_TIER_SERVICES = ['postgres', 'otel-collector'] as const;

/**
 * The services the stack starts for the catalog type in `env` — read without validating the rest
 * of the configuration, so preflight checks the right ports even when .env has other errors.
 */
export function stackServices(env: EnvironmentVariables = process.env): readonly string[] {
  return env.ATLASBI_LAKEHOUSE_CATALOG_TYPE === 'sqlite'
    ? PORTABLE_TIER_SERVICES
    : LOCAL_TIER_SERVICES;
}

/** Host ports of the given services (all of them by default), as compose.yaml publishes them. */
export function portsByService(
  ports: LocalInfraPorts,
  services: readonly string[] = LOCAL_TIER_SERVICES,
): Record<string, number[]> {
  const all: Record<string, number[]> = {
    postgres: [ports.postgres],
    'otel-collector': [ports.otelGrpc, ports.otelHttp, ports.otelHealth],
    'object-storage': [ports.objectStorage, ports.objectStorageAdmin],
    // Cube Store publishes nothing: only Cube talks to it, inside the stack network.
    'cube-store': [],
    cube: [ports.cube, ports.cubeSql],
  };
  return Object.fromEntries(Object.entries(all).filter(([service]) => services.includes(service)));
}
