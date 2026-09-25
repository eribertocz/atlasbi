import type { z } from 'zod';

import {
  environmentSchema,
  lakehouseEnvironmentSchema,
  toLakehouseConfig,
  toPlatformConfig,
  type LakehouseConfig,
  type PlatformConfig,
} from './config-schema.ts';
import { ConfigurationError } from './configuration-error.ts';

export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

export interface LoadConfigOptions {
  /** Base for relative paths in the configuration; defaults to the current directory. */
  baseDirectory?: string;
}

/** Validates the environment and fails fast with every problem listed, never a silent undefined. */
export function loadConfig(
  env: EnvironmentVariables = process.env,
  options: LoadConfigOptions = {},
): PlatformConfig {
  return toPlatformConfig(parse(environmentSchema, env), options.baseDirectory ?? process.cwd());
}

/** Only the lakehouse section — for checks that run before the rest of the configuration exists. */
export function loadLakehouseConfig(
  env: EnvironmentVariables = process.env,
  options: LoadConfigOptions = {},
): LakehouseConfig {
  return toLakehouseConfig(
    parse(lakehouseEnvironmentSchema, env),
    options.baseDirectory ?? process.cwd(),
  );
}

function parse<Schema extends z.ZodType>(
  schema: Schema,
  env: EnvironmentVariables,
): z.output<Schema> {
  const result = schema.safeParse(withoutEmptyValues(env));
  if (!result.success) {
    throw new ConfigurationError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}

// A `KEY=` line copied from .env.example means "not set", so defaults and required checks apply.
function withoutEmptyValues(env: EnvironmentVariables): EnvironmentVariables {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
}
