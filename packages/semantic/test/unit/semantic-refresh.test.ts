import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { parseSemanticRefreshSummary } from '@atlasbi/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { refreshSemanticLayer } from '../../src/index.ts';

const SECRET = 'a-semantic-api-secret-for-tests';

interface FakeCube {
  url: string;
  authorizations: string[];
  close(): Promise<void>;
}

/** Cube's pre-aggregation jobs endpoint, answering with what `answer` says for each call. */
async function fakeCube(
  answer: (body: { action: string }, call: number) => { status: number; body: unknown },
): Promise<FakeCube> {
  const authorizations: string[] = [];
  let calls = 0;
  const server: Server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    request.on('end', () => {
      authorizations.push(String(request.headers.authorization ?? ''));
      const { status, body } = answer(JSON.parse(raw) as { action: string }, calls++);
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    authorizations,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const job = (status: string, preAggregation = 'sales_orders.amount_by_region_month') => ({
  status,
  table: `prod_pre_aggregations.${preAggregation.replace('.', '_')}_x`,
  selector: { preAggregations: [preAggregation] },
});

describe('refreshSemanticLayer (Plan C)', () => {
  let cube: FakeCube | undefined;

  afterEach(async () => {
    await cube?.close();
    cube = undefined;
  });

  it('starts every build, waits for them, and reports each precomputed result once', async () => {
    cube = await fakeCube(({ action }, call) =>
      action === 'post'
        ? { status: 200, body: ['t1', 't2'] }
        : {
            status: 200,
            body:
              call < 3
                ? { t1: job('processing'), t2: job('scheduled') }
                : { t1: job('done'), t2: job('done') },
          },
    );

    const summary = await refreshSemanticLayer({ url: cube.url, apiSecret: SECRET }, { pollMs: 5 });

    expect(parseSemanticRefreshSummary(summary)).toEqual(summary);
    expect(summary).toMatchObject({
      status: 'succeeded',
      exitCode: 0,
      builds: [{ name: 'sales_orders.amount_by_region_month', status: 'built' }],
    });
    // Asked with a job token: the jobs scope, no groups.
    const payload = JSON.parse(
      Buffer.from(cube.authorizations[0]?.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({ sub: 'platform-jobs', scope: 'jobs' });
    expect(payload.groups).toBeUndefined();
  });

  it("names what failed to build, never with the layer's own text", async () => {
    cube = await fakeCube(({ action }) =>
      action === 'post'
        ? { status: 200, body: ['t1'] }
        : { status: 200, body: { t1: job('failure: SELECT secret_column FROM x failed') } },
    );

    const summary = await refreshSemanticLayer({ url: cube.url, apiSecret: SECRET }, { pollMs: 5 });

    expect([summary.exitCode, summary.error?.code]).toEqual([65, 'build_failed']);
    expect(summary.error?.message).toContain('sales_orders.amount_by_region_month');
    expect(summary.error?.message).not.toContain('secret_column');
  });

  it('answers each failure to reach the layer with its code', async () => {
    cube = await fakeCube(() => ({ status: 403, body: { error: 'API scope is missing: jobs' } }));
    const refused = await refreshSemanticLayer({ url: cube.url, apiSecret: SECRET });
    await cube.close();
    cube = await fakeCube(({ action }) =>
      action === 'post'
        ? { status: 200, body: ['t1'] }
        : { status: 200, body: { t1: job('processing') } },
    );
    const slow = await refreshSemanticLayer(
      { url: cube.url, apiSecret: SECRET },
      { timeoutMs: 30, pollMs: 5 },
    );
    const down = await refreshSemanticLayer({ url: 'http://127.0.0.1:1', apiSecret: SECRET });

    expect([refused.exitCode, refused.error?.code]).toEqual([77, 'credentials_refused']);
    expect([slow.exitCode, slow.error?.code, slow.retryable]).toEqual([
      75,
      'semantic_unavailable',
      true,
    ]);
    expect([down.exitCode, down.error?.code, down.retryable]).toEqual([
      75,
      'semantic_unavailable',
      true,
    ]);
  });

  it('succeeds with nothing to build', async () => {
    cube = await fakeCube(() => ({ status: 200, body: [] }));

    const summary = await refreshSemanticLayer({ url: cube.url, apiSecret: SECRET });

    expect(summary).toMatchObject({ status: 'succeeded', builds: [] });
  });
});
