import type { AppRouter } from '@atlasbi/api-gateway';
import { createTRPCClient, httpLink } from '@trpc/client';

import type { Session } from '../session/session.svelte.ts';

/** What the tRPC link hands to `fetch`; its `signal` may be undefined (exactOptionalPropertyTypes). */
type FetchInit = Omit<RequestInit, 'signal'> & { signal?: AbortSignal | null | undefined };

/**
 * The internal BFF of the gateway (docs/06 §7), typed end to end from its `AppRouter` — no
 * generated code. One HTTP request per call, never a batch: each widget can cancel its own query,
 * and two parallel requests answer sooner than one batch (build step 6, Phase 0, P6-5). Queries go
 * by POST, as the gateway requires (adjustment 4 of build step 5).
 */
export function createApiClient(
  session: Pick<Session, 'token' | 'renew'>,
  options: { fetch?: typeof fetch; url?: string } = {},
) {
  const send = options.fetch ?? ((input, init) => fetch(input, init));

  async function authorizedFetch(input: RequestInfo | URL, init?: FetchInit): Promise<Response> {
    const attempt = () => {
      const headers = new Headers(init?.headers);
      if (session.token !== undefined) {
        headers.set('authorization', `Bearer ${session.token}`);
      }
      return send(input, { ...init, signal: init?.signal ?? null, headers });
    };
    const response = await attempt();
    // An expired token is renewed once from the session cookie; a second 401 is the answer.
    if (response.status !== 401 || !(await session.renew())) {
      return response;
    }
    return attempt();
  }

  return createTRPCClient<AppRouter>({
    links: [
      httpLink({ url: options.url ?? '/api/trpc', methodOverride: 'POST', fetch: authorizedFetch }),
    ],
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
