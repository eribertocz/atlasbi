import type { SecretProvider } from '@atlasbi/contracts';

import type { PlatformConfig } from '../config-schema.ts';
import type { EnvironmentVariables } from '../load-config.ts';
import { EnvSecretProvider } from './env-secret-provider.ts';

export function createSecretProvider(
  config: PlatformConfig,
  env: EnvironmentVariables = process.env,
): SecretProvider {
  switch (config.secretProvider) {
    case 'env':
      return new EnvSecretProvider(env);
  }
}
