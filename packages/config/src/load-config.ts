import { environmentSchema, toPlatformConfig, type PlatformConfig } from './config-schema.ts';
import { ConfigurationError } from './configuration-error.ts';

export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

/** Validates the environment and fails fast with every problem listed, never a silent undefined. */
export function loadConfig(env: EnvironmentVariables = process.env): PlatformConfig {
  const result = environmentSchema.safeParse(withoutEmptyValues(env));
  if (!result.success) {
    throw new ConfigurationError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return toPlatformConfig(result.data);
}

// A `KEY=` line copied from .env.example means "not set", so defaults and required checks apply.
function withoutEmptyValues(env: EnvironmentVariables): EnvironmentVariables {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
}
