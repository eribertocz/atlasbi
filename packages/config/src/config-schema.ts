import { z } from 'zod';

/** Config Schema contract version (docs/21 §2) — bump when a variable changes meaning or is removed. */
export const CONFIG_SCHEMA_VERSION = 1;

/** Wire format: the non-secret environment variables a platform process reads. */
export const environmentSchema = z.object({
  ATLASBI_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ATLASBI_SECRET_PROVIDER: z.enum(['env']).default('env'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
});

export type Environment = z.infer<typeof environmentSchema>;

/** Domain shape of the configuration — code never reads env var names directly. */
export interface PlatformConfig {
  environment: Environment['ATLASBI_ENV'];
  secretProvider: Environment['ATLASBI_SECRET_PROVIDER'];
  telemetry: {
    otlpEndpoint: string;
  };
}

export function toPlatformConfig(environment: Environment): PlatformConfig {
  return {
    environment: environment.ATLASBI_ENV,
    secretProvider: environment.ATLASBI_SECRET_PROVIDER,
    telemetry: {
      otlpEndpoint: environment.OTEL_EXPORTER_OTLP_ENDPOINT,
    },
  };
}
