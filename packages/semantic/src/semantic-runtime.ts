import { type PlatformConfig, SECRET_KEYS } from '@atlasbi/config';
import type { SecretProvider, SemanticRuntimePort } from '@atlasbi/contracts';

import { createCubeSemanticRuntime } from './adapters/cube/cube-semantic-runtime.ts';

/**
 * The semantic runtime of this deployment, or `undefined` where the semantic layer does not run
 * (`config.semantic.enabled`). Which engine answers, and what it needs, is this package's business:
 * callers get the port, never the adapter (docs/21 §3; layer-isolation audit, 2026-10-04).
 */
export async function createSemanticRuntime(options: {
  config: Pick<PlatformConfig, 'semantic'>;
  secrets: SecretProvider;
}): Promise<SemanticRuntimePort | undefined> {
  if (!options.config.semantic.enabled) {
    return undefined;
  }
  return createCubeSemanticRuntime({
    url: options.config.semantic.url,
    apiSecret: await options.secrets.get(SECRET_KEYS.semanticApiSecret),
  });
}
