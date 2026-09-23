import { SecretNotFoundError, type SecretProvider } from '@atlasbi/contracts';

import { ConfigurationError } from '../configuration-error.ts';

/** Resolves every key up front so a process fails at startup, listing all missing secrets. */
export async function assertSecretsAvailable(
  provider: SecretProvider,
  keys: readonly string[],
): Promise<void> {
  const results = await Promise.allSettled(keys.map((key) => provider.get(key)));
  const issues = results.flatMap((result, index) =>
    result.status === 'rejected' ? [describeFailure(keys[index] ?? '', result.reason)] : [],
  );
  if (issues.length > 0) {
    throw new ConfigurationError(issues);
  }
}

function describeFailure(key: string, reason: unknown): string {
  if (reason instanceof SecretNotFoundError) {
    return reason.message;
  }
  return `Secret "${key}" could not be resolved: ${reason instanceof Error ? reason.message : String(reason)}`;
}
