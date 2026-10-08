import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { loadConfig } from '@atlasbi/config';
import { afterEach, describe, expect, it } from 'vitest';

import {
  GATEWAY_STEP,
  gatewayContainerReadinessStep,
  gatewayReadinessStep,
} from '../../src/health/gateway-probes.ts';
import {
  localProcessPorts,
  PLATFORM_SERVICES,
  portsByService,
  readLocalInfraPorts,
  stackDatabaseUrl,
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

describe('the API gateway in its container (pnpm stack:up)', () => {
  it('waits until /ready answers inside the container', async () => {
    let asked = 0;
    const step = gatewayContainerReadinessStep({
      dependsOn: ['Migrations', 'Cube'],
      isReady: () => Promise.resolve((asked += 1) > 2),
      timing: FAST,
    });

    await expect(step.ensureReady()).resolves.toBe(
      'healthy — in its container, reached through Web',
    );
    expect([step.name, step.dependsOn]).toEqual([GATEWAY_STEP, ['Migrations', 'Cube']]);
    expect(asked).toBe(3);
  });

  it('says where it looked when /ready never answers', async () => {
    const step = gatewayContainerReadinessStep({
      dependsOn: [],
      isReady: () => Promise.resolve(false),
      timing: { timeoutMs: 100, intervalMs: 20 },
    });

    await expect(step.ensureReady()).rejects.toThrow(
      '/ready does not answer 200 inside its container',
    );
  });
});

describe("the database URL of the gateway's container", () => {
  it('takes any password: every part is percent-encoded and reads back unchanged', () => {
    const password = 'p@ss:w/rd #?%&é';
    const url = new URL(
      stackDatabaseUrl({
        ATLASBI_POSTGRES_USER: 'atlas bi',
        ATLASBI_POSTGRES_PASSWORD: password,
        ATLASBI_POSTGRES_DB: 'atlasbi',
      }) ?? '',
    );

    expect([url.protocol, url.hostname, url.port, url.pathname]).toEqual([
      'postgres:',
      'postgres',
      '5432',
      '/atlasbi',
    ]);
    expect(decodeURIComponent(url.username)).toBe('atlas bi');
    expect(decodeURIComponent(url.password)).toBe(password);
  });

  it('is not built while a part is missing', () => {
    expect(
      stackDatabaseUrl({ ATLASBI_POSTGRES_USER: 'atlasbi', ATLASBI_POSTGRES_DB: 'atlasbi' }),
    ).toBeUndefined();
  });
});

describe("the platform services' ports", () => {
  it('as local processes, are checked by preflight on every tier, with the Config Schema defaults', () => {
    const ports = readLocalInfraPorts({});
    const config = loadConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' });

    expect(PLATFORM_SERVICES).toEqual(['api-gateway', 'web']);
    expect(localProcessPorts(ports)).toEqual({ 'api-gateway': [4100], web: [3000] });
    expect(
      localProcessPorts(
        readLocalInfraPorts({ ATLASBI_GATEWAY_PORT: '4200', ATLASBI_WEB_PORT: '3100' }),
      ),
    ).toEqual({ 'api-gateway': [4200], web: [3100] });
    expect([ports.gateway, ports.web]).toEqual([config.gateway.port, config.web.port]);
  });

  it('as containers, publish only the web origin: the gateway is reached through it', () => {
    expect(portsByService(readLocalInfraPorts({}), PLATFORM_SERVICES)).toEqual({
      'api-gateway': [],
      web: [3000],
    });
  });
});
