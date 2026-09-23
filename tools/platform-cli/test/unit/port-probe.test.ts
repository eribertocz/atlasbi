import net from 'node:net';

import { describe, expect, it } from 'vitest';

import { isPortFree } from '../../src/checks/environment-checks.ts';

describe('isPortFree', () => {
  it('reports a port with a listener as taken', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      await expect(isPortFree(port)).resolves.toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('reports a port as free once its listener is gone, even with connections in TIME_WAIT', async () => {
    const server = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    // A served connection that the server closes first leaves a TIME_WAIT socket behind.
    await new Promise<void>((resolve) =>
      net.connect(port, '127.0.0.1').on('close', () => resolve()),
    );
    await new Promise((resolve) => server.close(resolve));

    await expect(isPortFree(port)).resolves.toBe(true);
  });
});
