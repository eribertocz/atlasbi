import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { errorLines, startWatchedProcess } from '../../src/system/watched-process.ts';

async function until(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting');
    }
    await delay(50);
  }
}

function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

describe('a platform service under node --watch', () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'atlasbi-cli-watch-'));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('reports a script that fails at startup, with its error and not its stack', async () => {
    await writeFile(
      path.join(folder, 'main.mjs'),
      "console.log('starting');\nthrow new Error('ATLASBI_PUBLIC_URL must be scheme://host');\n",
    );
    const service = startWatchedProcess('main.mjs', { cwd: folder });
    try {
      await until(() => service.failedToStart());

      expect(service.failureReason()).toBe('Error: ATLASBI_PUBLIC_URL must be scheme://host');
    } finally {
      await service.stop();
    }
  });

  it('stops the script node --watch runs too: its port is free afterwards', async () => {
    await writeFile(
      path.join(folder, 'main.mjs'),
      "import { createServer } from 'node:http';\n" +
        "const server = createServer((request, response) => response.end('ok'));\n" +
        "server.listen(0, '127.0.0.1', () => console.log(`port=${server.address().port}`));\n",
    );
    const service = startWatchedProcess('main.mjs', { cwd: folder });
    const lines: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(' '));
    try {
      service.forwardOutput('[test]');
      await until(() => lines.some((line) => line.includes('port=')));
    } finally {
      console.log = log;
    }
    const port = Number(/port=(\d+)/.exec(lines.join('\n'))?.[1]);
    expect(await accepts(port)).toBe(true);

    await service.stop();

    // Not orphaned: Windows ends a process asynchronously, so its socket closes moments later —
    // an orphan would hold the port for good.
    const deadline = Date.now() + 5_000;
    while ((await accepts(port)) && Date.now() < deadline) {
      await delay(50);
    }
    expect(await accepts(port)).toBe(false);
    await expect(service.exited).resolves.not.toBeUndefined();
  });
});

describe('the reason a service failed', () => {
  it('keeps the error lines and drops the stack and node --watch chatter', () => {
    const output = [
      'starting',
      "Failed running 'main.ts'. Waiting for file changes before restarting...",
      'file:///E:/bi-platform/packages/api-gateway/src/main.ts:16',
      'const config = loadConfig();',
      '               ^',
      '',
      'ConfigurationError: Invalid configuration:',
      '  - ATLASBI_PUBLIC_URL: must be scheme://host[:port] only',
      '    at loadConfig (file:///E:/bi-platform/packages/config/src/load-config.ts:25:10)',
      '',
      'Node.js v24.21.0',
    ].join('\n');

    expect(errorLines(output)).toBe(
      'ConfigurationError: Invalid configuration: - ATLASBI_PUBLIC_URL: must be scheme://host[:port] only',
    );
    expect(errorLines('starting\r\nError: no secret\r\n    at main.mjs:2:7\r\n')).toBe(
      'Error: no secret',
    );
    expect(errorLines('just a line\n')).toBe('just a line');
  });
});
