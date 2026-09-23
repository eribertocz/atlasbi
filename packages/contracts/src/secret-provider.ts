/**
 * Port for resolving secrets (docs/11-infraestructura.md §4.7).
 *
 * Keys are platform-owned logical names such as `database.url`; each adapter decides
 * where a key lives (an environment variable, an OpenBao path, a cloud secret manager).
 * Adapters must reject with {@link SecretNotFoundError} — never with a vendor error.
 */
export interface SecretProvider {
  get(key: string): Promise<string>;
}

export class SecretNotFoundError extends Error {
  readonly key: string;
  /** Adapter-specific, human-readable remediation (e.g. which variable to set). */
  readonly hint: string | undefined;

  constructor(key: string, hint?: string) {
    super(
      hint === undefined
        ? `Secret "${key}" is not available.`
        : `Secret "${key}" is not available: ${hint}.`,
    );
    this.name = 'SecretNotFoundError';
    this.key = key;
    this.hint = hint;
  }
}
