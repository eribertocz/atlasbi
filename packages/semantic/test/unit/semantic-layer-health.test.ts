import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  probeSemanticLayer,
  QUERY_TOKEN,
  SemanticLayerUnavailableError,
  signQueryToken,
} from '../../src/index.ts';

const SECRET = 'test-api-secret';

function verifies(token: string, secret: string): boolean {
  const [head, body, signature] = token.split('.');
  return (
    createHmac('sha256', secret)
      .update(`${head ?? ''}.${body ?? ''}`)
      .digest('base64url') === signature
  );
}

// A fake Cube: /readyz, and /cubejs-api/v1/load answering like Cube 1.7.45 does.
function fakeCube(options: {
  readyz?: number;
  load?: (attempt: number) => { status: number; body: unknown };
}): Promise<Server> {
  let attempt = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fake');
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (url.pathname === '/readyz') {
      reply(options.readyz ?? 200, { health: 'HEALTH' });
      return;
    }
    if (!verifies(request.headers.authorization ?? '', SECRET)) {
      reply(403, { error: 'Invalid token' });
      return;
    }
    const answer = options.load?.(attempt++) ?? { status: 200, body: { data: [{ zone: 'Axis' }] } };
    reply(answer.status, answer.body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

describe('probeSemanticLayer', () => {
  let server: Server | undefined;
  const url = () => `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;

  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
  });

  it('is healthy once a query that reads the lakehouse answers, waiting through "Continue wait"', async () => {
    server = await fakeCube({
      load: (attempt) =>
        attempt < 2
          ? { status: 200, body: { error: 'Continue wait' } }
          : { status: 200, body: { data: [{ 'regions.zone': 'Axis' }] } },
    });

    await expect(probeSemanticLayer({ url: url(), apiSecret: SECRET })).resolves.toBeUndefined();
  });

  it('is not healthy when /readyz says so', async () => {
    server = await fakeCube({ readyz: 500 });

    await expect(probeSemanticLayer({ url: url(), apiSecret: SECRET })).rejects.toThrow(
      /not ready \(HTTP 500\)/,
    );
  });

  it('is not healthy when the lakehouse cannot answer, passing on what Cube tells clients', async () => {
    server = await fakeCube({
      load: () => ({
        status: 400,
        body: { error: 'Error: The lakehouse is unavailable to the semantic layer; …' },
      }),
    });

    await expect(probeSemanticLayer({ url: url(), apiSecret: SECRET })).rejects.toThrow(
      /cannot answer from the lakehouse: Error: The lakehouse is unavailable/,
    );
  });

  it('points at the shared API secret when Cube rejects the token', async () => {
    server = await fakeCube({});

    const error = await probeSemanticLayer({ url: url(), apiSecret: 'another-secret' }).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(SemanticLayerUnavailableError);
    expect((error as SemanticLayerUnavailableError).remedy).toContain(
      'ATLASBI_SEMANTIC_API_SECRET',
    );
    // Waiting cannot fix a rejected token: readiness gives up at once.
    expect((error as SemanticLayerUnavailableError).retryable).toBe(false);
  });
});

function payloadOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

describe('signQueryToken', () => {
  it('signs a short-lived HS256 token for Cube, with the platform issuer and audience', () => {
    const token = signQueryToken(SECRET, { sub: 'someone' }, 30);
    const payload = payloadOf(token) as {
      sub: string;
      iss: string;
      aud: string;
      iat: number;
      exp: number;
    };

    expect(verifies(token, SECRET)).toBe(true);
    expect(verifies(token, 'wrong')).toBe(false);
    expect(payload).toMatchObject({ sub: 'someone', iss: 'platform-api', aud: 'semantic-layer' });
    expect(payload.exp - payload.iat).toBe(30);
  });

  it('lives five minutes by default and never longer (decision E3, REST and SQL API alike)', () => {
    const payload = payloadOf(signQueryToken(SECRET, {})) as { iat: number; exp: number };

    expect(payload.exp - payload.iat).toBe(QUERY_TOKEN.maxLifetimeSeconds);
    expect(QUERY_TOKEN.maxLifetimeSeconds).toBe(300);
    expect(() => signQueryToken(SECRET, {}, 301)).toThrow(RangeError);
    expect(() => signQueryToken(SECRET, {}, 0)).toThrow(RangeError);
  });

  it('never lets the claims choose the issuer, audience or times', () => {
    const payload = payloadOf(
      signQueryToken(SECRET, { iss: 'someone', aud: 'anything', exp: 9_999_999_999 }, 60),
    ) as { iss: string; aud: string; iat: number; exp: number };

    expect(payload).toMatchObject({ iss: 'platform-api', aud: 'semantic-layer' });
    expect(payload.exp - payload.iat).toBe(60);
  });

  it('probes readiness with the readiness group only', async () => {
    let seen: Record<string, unknown> | undefined;
    const server = createServer((request, response) => {
      if (request.url?.startsWith('/cubejs-api')) {
        seen = payloadOf(request.headers.authorization ?? '');
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      await probeSemanticLayer({ url: `http://127.0.0.1:${port}`, apiSecret: SECRET });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    expect(seen).toMatchObject({ groups: ['readiness'] });
    expect(seen).not.toHaveProperty('entitlements');
  });
});
