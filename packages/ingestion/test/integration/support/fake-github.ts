import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** An event as GitHub's REST API returns it — the fields the landing reads, and a few more. */
export interface FakeEvent {
  id: string;
  type: string;
  actor: string;
  createdAt: string;
  /** Overrides of the event's `public` field, to change its type between runs. */
  public?: unknown;
}

export type FakeFailure = { status: 401 | 404 | 500 | 503 } | { status: 403; rateLimited: boolean };

export interface FakeGitHub {
  apiUrl: string;
  token: string;
  /** Events per `owner/name`, newest first as GitHub sends them. */
  events: Map<string, FakeEvent[]>;
  /** Answers every request with this, while set. */
  failure: FakeFailure | undefined;
  /** Every request, as `METHOD path` with the token it carried (or none). */
  requests: { path: string; authorized: boolean }[];
  close(): Promise<void>;
}

const PAGE_SIZE = 100;

/**
 * GitHub's events API, small enough to reason about: pages of 100 with a `Link` header, the rate
 * limit headers the copied source reads, and 401 for a wrong token, as GitHub does.
 */
export async function startFakeGitHub(token: string): Promise<FakeGitHub> {
  const fake: FakeGitHub = {
    apiUrl: '',
    token,
    events: new Map(),
    failure: undefined,
    requests: [],
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fake');
    const authorized = request.headers.authorization === `Bearer ${token}`;
    fake.requests.push({ path: `${request.method} ${url.pathname}`, authorized });
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, {
        'content-type': 'application/json',
        'x-ratelimit-remaining': '4999',
        ...headers,
      });
      response.end(JSON.stringify(body));
    };
    const failure = fake.failure;
    if (failure !== undefined) {
      if (failure.status === 403 && failure.rateLimited) {
        json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' });
      } else {
        json(failure.status, { message: `failure ${failure.status}` });
      }
      return;
    }
    if (!authorized) {
      json(401, { message: 'Bad credentials' });
      return;
    }
    const match = /^\/repos\/([^/]+)\/([^/]+)\/events$/.exec(url.pathname);
    const events = match ? fake.events.get(`${match[1]}/${match[2]}`) : undefined;
    if (match === null || events === undefined) {
      json(404, { message: 'Not Found' });
      return;
    }
    const page = Number(url.searchParams.get('page') ?? '1');
    const slice = events.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const hasNext = page * PAGE_SIZE < events.length;
    const next = new URL(url.toString().replace('http://fake', fake.apiUrl));
    next.searchParams.set('page', String(page + 1));
    /* eslint-disable @typescript-eslint/naming-convention -- GitHub's JSON. */
    json(
      200,
      slice.map((event) => ({
        id: event.id,
        type: event.type,
        actor: { id: 1, login: event.actor, display_login: event.actor, url: 'u', avatar_url: 'a' },
        repo: { id: 2, name: `${match[1]}/${match[2]}`, url: 'r' },
        payload: { action: 'started' },
        public: 'public' in event ? event.public : true,
        created_at: event.createdAt,
      })),
      hasNext ? { link: `<${next.toString()}>; rel="next"` } : {},
    );
    /* eslint-enable @typescript-eslint/naming-convention */
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}

/** `count` events of a repository, newest first, one second apart, ending at `newest`. */
export function eventsOf(
  repository: string,
  count: number,
  options: { from?: number; newest?: string; types?: readonly string[] } = {},
): FakeEvent[] {
  const newest = Date.parse(options.newest ?? '2026-10-07T12:00:00Z');
  const types = options.types ?? ['PushEvent', 'IssuesEvent', 'WatchEvent'];
  const from = options.from ?? 0;
  return [...Array(count).keys()].map((index) => ({
    id: `${repository}#${from + count - index}`,
    type: types[(from + count - index) % types.length] ?? 'PushEvent',
    actor: `actor-${(from + count - index) % 4}`,
    createdAt: new Date(newest - index * 1_000).toISOString().replace('.000Z', 'Z'),
  }));
}
