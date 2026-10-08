import { createServer, type Server } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkPorts,
  devPortScope,
  infrastructurePortScope,
  stackPortScope,
} from '../../src/checks/environment-checks.ts';
import { runningServices } from '../../src/container-runtime/podman.ts';
import {
  LOCAL_TIER_SERVICES,
  PLATFORM_SERVICES,
  readLocalInfraPorts,
} from '../../src/local-environment.ts';

vi.mock('../../src/container-runtime/podman.ts', () => ({ runningServices: vi.fn() }));

describe('which ports preflight checks, per command', () => {
  let holder: Server;
  let port: number;

  beforeEach(async () => {
    // Something listening where the web origin goes: Vite, or the proxy's container.
    holder = createServer();
    await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve));
    port = (holder.address() as { port: number }).port;
    vi.mocked(runningServices).mockResolvedValue(new Set(['web']));
  });

  afterEach(async () => {
    await new Promise((resolve) => holder.close(resolve));
  });

  it('starts the platform as processes under `pnpm dev`, as containers under `stack:up`', () => {
    expect(devPortScope()).toEqual({
      containers: LOCAL_TIER_SERVICES,
      processes: PLATFORM_SERVICES,
    });
    expect(stackPortScope()).toEqual({
      containers: [...LOCAL_TIER_SERVICES, ...PLATFORM_SERVICES],
      processes: [],
    });
    expect(infrastructurePortScope()).toEqual({ containers: LOCAL_TIER_SERVICES, processes: [] });
  });

  it('takes the stack’s own running proxy for no conflict when starting the stack again', async () => {
    const ports = readLocalInfraPorts({ ATLASBI_WEB_PORT: String(port) });

    await expect(checkPorts(ports, { containers: ['web'], processes: [] })).resolves.toEqual({
      name: 'Ports',
      status: 'pass',
      detail: `${port} held by the running stack`,
    });
  });

  it('refuses to start Vite where the stack’s proxy already listens', async () => {
    const ports = readLocalInfraPorts({ ATLASBI_WEB_PORT: String(port) });

    const result = await checkPorts(ports, { containers: [], processes: ['web'] });

    expect(result).toMatchObject({
      status: 'fail',
      detail: `in use by another process: ${port} (web — its container is running)`,
    });
    expect(result.remedy).toContain('`pnpm stack:down` stops the containerized stack');
  });
});
