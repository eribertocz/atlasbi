/** What a sign-in attempt ended in, as the page shows it. */
export type SignInOutcome =
  'signed-in' | 'invalid-credentials' | 'too-many-attempts' | 'unavailable';

export type SessionStatus = 'unknown' | 'signed-in' | 'signed-out';

/** The token is renewed once this share of its lifetime has passed (build step 6, Phase 0). */
export const RENEW_AT_SHARE_OF_LIFETIME = 0.8;
const MIN_RENEW_DELAY_MS = 1_000;

/** Seconds the token lives, from its own claims: no clock comparison with the server. */
function lifetimeSeconds(token: string): number {
  const payload = token.split('.')[1] ?? '';
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      iat?: number;
      exp?: number;
    };
    return typeof claims.iat === 'number' && typeof claims.exp === 'number'
      ? claims.exp - claims.iat
      : 0;
  } catch {
    return 0;
  }
}

/**
 * The person signed in to this tab (decision G1, build step 6 decision H1). The identity token lives
 * in memory only — never in storage a script could read later — and is renewed from the session
 * cookie before it expires, and once more when the API answers 401. Reloading the page restores it
 * from the cookie.
 */
export class Session {
  status = $state<SessionStatus>('unknown');
  #token = $state.raw<string | undefined>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #renewal: Promise<boolean> | undefined;
  readonly #fetch: typeof fetch;

  constructor(options: { fetch?: typeof fetch } = {}) {
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** The identity token for `Authorization: Bearer`, while signed in. */
  get token(): string | undefined {
    return this.#token;
  }

  /** On page load: the session cookie, if there is one, gives a token. */
  restore(): Promise<boolean> {
    return this.renew();
  }

  async signIn(email: string, password: string): Promise<SignInOutcome> {
    const response = await this.#fetch('/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).catch(() => undefined);
    if (response?.ok === true) {
      return (await this.renew()) ? 'signed-in' : 'unavailable';
    }
    if (response?.status === 401) {
      return 'invalid-credentials';
    }
    return response?.status === 429 ? 'too-many-attempts' : 'unavailable';
  }

  async signOut(): Promise<void> {
    await this.#fetch('/auth/sign-out', { method: 'POST' }).catch(() => undefined);
    this.#forget();
  }

  /**
   * A fresh token from the session cookie; false when there is no session anymore. Concurrent
   * callers — several requests answered 401 at once — share one renewal.
   */
  renew(): Promise<boolean> {
    this.#renewal ??= this.#requestToken().finally(() => {
      this.#renewal = undefined;
    });
    return this.#renewal;
  }

  async #requestToken(): Promise<boolean> {
    const response = await this.#fetch('/auth/token').catch(() => undefined);
    const body =
      response?.ok === true
        ? ((await response.json().catch(() => ({}))) as { token?: unknown })
        : {};
    if (typeof body.token !== 'string') {
      this.#forget();
      return false;
    }
    this.#token = body.token;
    this.status = 'signed-in';
    this.#schedule(lifetimeSeconds(body.token));
    return true;
  }

  #schedule(lifetime: number): void {
    clearTimeout(this.#timer);
    if (lifetime <= 0) {
      return;
    }
    const delay = Math.max(MIN_RENEW_DELAY_MS, lifetime * 1_000 * RENEW_AT_SHARE_OF_LIFETIME);
    this.#timer = setTimeout(() => void this.renew(), delay);
  }

  #forget(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#token = undefined;
    this.status = 'signed-out';
  }
}
