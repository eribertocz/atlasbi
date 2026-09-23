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
});

export interface LocalInfraPorts {
  postgres: number;
  otelGrpc: number;
  otelHttp: number;
  otelHealth: number;
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
  };
}

export function portsByService(ports: LocalInfraPorts): Record<string, number[]> {
  return {
    postgres: [ports.postgres],
    'otel-collector': [ports.otelGrpc, ports.otelHttp, ports.otelHealth],
  };
}
