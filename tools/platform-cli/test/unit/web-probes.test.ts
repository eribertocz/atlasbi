import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { WEB_STEP, webReadinessStep } from '../../src/health/web-probes.ts';
import { PLATFORM_IMAGES, PLATFORM_SERVICES } from '../../src/local-environment.ts';
import type { WatchedProcess } from '../../src/system/watched-process.ts';
import { WORKSPACE_FILES } from '../../src/workspace-paths.ts';

const FAST = { timeoutMs: 2_000, intervalMs: 20 };

function fakeProcess(failure?: string): WatchedProcess {
  return {
    exited: new Promise<number | null>(() => undefined),
    failedToStart: () => failure !== undefined,
    failureReason: () => failure ?? '',
    forwardOutput: () => undefined,
    stop: () => Promise.resolve(),
  };
}

describe('the Web readiness step', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined));
    server = undefined;
  });

  /** A fake origin: the app's page, and /auth/token answering what the gateway behind it would. */
  async function origin(answers: { page?: number; token: () => number }): Promise<number> {
    server = createServer((request, response) => {
      if (request.url === '/auth/token') {
        response.statusCode = answers.token();
        response.end();
        return;
      }
      response.statusCode = answers.page ?? 200;
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html>');
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  it('starts the dev server once and waits until the origin reaches the gateway', async () => {
    let tokenAnswers = 0;
    // The proxy answers 502 until the gateway behind it listens; then the gateway's 401.
    const port = await origin({ token: () => ((tokenAnswers += 1) > 2 ? 401 : 502) });
    let starts = 0;
    const { step, started } = webReadinessStep({
      port,
      dependsOn: ['API Gateway'],
      start: () => {
        starts += 1;
        return fakeProcess();
      },
      timing: FAST,
    });

    await expect(step.ensureReady()).resolves.toBe(`healthy — http://127.0.0.1:${port}`);
    expect([step.name, step.dependsOn]).toEqual([WEB_STEP, ['API Gateway']]);
    expect(starts).toBe(1);
    expect(started()).toBeDefined();
  });

  it('starts nothing when the proxy already runs in its container (pnpm stack:up)', async () => {
    const port = await origin({ token: () => 401 });
    const { step, started } = webReadinessStep({ port, dependsOn: [], timing: FAST });

    await expect(step.ensureReady()).resolves.toBe(`healthy — http://127.0.0.1:${port}`);
    expect(started()).toBeUndefined();
  });

  it('fails at once with the reason when the dev server cannot start', async () => {
    const port = await origin({ page: 503, token: () => 502 });
    const { step } = webReadinessStep({
      port,
      dependsOn: [],
      start: () => fakeProcess('Error: Port 3000 is already in use'),
      timing: { timeoutMs: 60_000, intervalMs: 20 },
    });
    const startedAt = Date.now();

    await expect(step.ensureReady()).rejects.toThrow(
      'it failed to start: Error: Port 3000 is already in use',
    );
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it('says the origin does not reach the gateway when /auth keeps failing', async () => {
    const port = await origin({ token: () => 502 });
    const { step } = webReadinessStep({
      port,
      dependsOn: [],
      timing: { timeoutMs: 200, intervalMs: 20 },
    });

    await expect(step.ensureReady()).rejects.toThrow(
      'the origin does not reach the API gateway: /auth/token answered HTTP 502',
    );
  });
});

describe('the platform images', () => {
  it('are the ones compose.yaml runs, built from the same Containerfiles', () => {
    const compose = readFileSync(WORKSPACE_FILES.composeFile, 'utf8');

    for (const service of PLATFORM_SERVICES) {
      const { tag, containerfile } = PLATFORM_IMAGES[service];
      expect(compose).toContain(`  ${service}:\n`);
      expect(compose).toContain(`image: ${tag}\n`);
      expect(compose).toContain(`dockerfile: ${containerfile}\n`);
    }
  });
});
