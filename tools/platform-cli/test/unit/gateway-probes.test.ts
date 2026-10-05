import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { loadConfig } from '@atlasbi/config';
import { afterEach, describe, expect, it } from 'vitest';

import { GATEWAY_STEP, gatewayReadinessStep } from '../../src/health/gateway-probes.ts';
import {
  LOCAL_PROCESSES,
  portsByService,
  readLocalInfraPorts,
} from '../../src/local-environment.ts';
import type { WatchedProcess } from '../../src/system/watched-process.ts';

const FAST = { timeoutMs: 2_000, intervalMs: 20 };

function fakeProcess(failure?: string): WatchedProcess & { stopped: boolean } {
  const fake = {
    stopped: false,
    exited: new Promise<number | null>(() => undefined),
    failedToStart: () => failure !== undefined,
    failureReason: () => failure ?? '',
    forwardOutput: () => undefined,
    stop: () => {
      fake.stopped = true;
      return Promise.resolve();
    },
  };
  return fake;
}

describe('the API gateway readiness step', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined));
    server = undefined;
  });

  async function readyAfter(notReadyAnswers: number): Promise<number> {
    let answered = 0;
    server = createServer((request, response) => {
      answered += 1;
      response.statusCode = request.url === '/ready' && answered > notReadyAnswers ? 200 : 503;
      response.end();
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  it('starts the gateway once and waits until /ready answers 200', async () => {
    const port = await readyAfter(2);
    let starts = 0;
    const { step, started } = gatewayReadinessStep({
      port,
      dependsOn: ['Migrations'],
      start: () => {
        starts += 1;
        return fakeProcess();
      },
      timing: FAST,
    });

    await expect(step.ensureReady()).resolves.toBe(`healthy — http://127.0.0.1:${port}`);
    expect(step.name).toBe(GATEWAY_STEP);
    expect(step.dependsOn).toEqual(['Migrations']);
    expect(starts).toBe(1);
    expect(started()).toBeDefined();
  });

  it('fails at once with the reason when the gateway cannot start', async () => {
    const port = await readyAfter(Number.POSITIVE_INFINITY);
    const { step } = gatewayReadinessStep({
      port,
      dependsOn: [],
      start: () =>
        fakeProcess('ConfigurationError: ATLASBI_PUBLIC_URL must be scheme://host[:port] only'),
      timing: { timeoutMs: 60_000, intervalMs: 20 },
    });
    const startedAt = Date.now();

    await expect(step.ensureReady()).rejects.toThrow(
      'it failed to start: ConfigurationError: ATLASBI_PUBLIC_URL must be scheme://host[:port] only',
    );
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it('says the database does not answer when /ready keeps answering 503', async () => {
    const port = await readyAfter(Number.POSITIVE_INFINITY);
    const { step } = gatewayReadinessStep({
      port,
      dependsOn: [],
      start: () => fakeProcess(),
      timing: { timeoutMs: 200, intervalMs: 20 },
    });

    await expect(step.ensureReady()).rejects.toThrow(
      '/ready answered HTTP 503: the platform database does not answer it',
    );
  });
});

describe("the API gateway's port", () => {
  it('is checked by preflight on every tier, with the Config Schema default', () => {
    const ports = readLocalInfraPorts({});

    expect(LOCAL_PROCESSES).toEqual(['api-gateway']);
    expect(portsByService(ports)['api-gateway']).toEqual([4100]);
    expect(
      portsByService(readLocalInfraPorts({ ATLASBI_GATEWAY_PORT: '4200' }))['api-gateway'],
    ).toEqual([4200]);
    expect(ports.gateway).toBe(
      loadConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' }).gateway.port,
    );
  });
});
