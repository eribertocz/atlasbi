import net from 'node:net';

import { ComposeProviderNotFoundError } from '../container-runtime/compose-provider.ts';
import { runningServices } from '../container-runtime/podman.ts';
import { hasEnvFile, portsByService, type LocalInfraPorts } from '../local-environment.ts';
import { CommandNotFoundError } from '../system/run-command.ts';
import type { CheckResult } from './check-result.ts';

export function checkEnvFile(): CheckResult {
  return hasEnvFile()
    ? { name: '.env', status: 'pass', detail: 'present' }
    : { name: '.env', status: 'warn', detail: 'not created yet — `pnpm bootstrap` creates it' };
}

/** Ports already held by this project's own running containers are not conflicts. */
export async function checkPorts(ports: LocalInfraPorts): Promise<CheckResult> {
  const running = await runningServicesOrNone();
  const conflicts: string[] = [];
  const available: number[] = [];
  const heldByStack: number[] = [];
  for (const [service, servicePorts] of Object.entries(portsByService(ports))) {
    if (running.has(service)) {
      heldByStack.push(...servicePorts);
      continue;
    }
    for (const port of servicePorts) {
      if (await isPortFree(port)) {
        available.push(port);
      } else {
        conflicts.push(`${port} (${service})`);
      }
    }
  }
  if (conflicts.length > 0) {
    return {
      name: 'Ports',
      status: 'fail',
      detail: `in use by another process: ${conflicts.join(', ')}`,
      remedy:
        'Stop that process, or change the ATLASBI_*_PORT values in .env (keep ATLASBI_DATABASE_URL in sync).',
    };
  }
  const parts = [
    available.length > 0 ? `${available.join(', ')} available` : '',
    heldByStack.length > 0 ? `${heldByStack.join(', ')} held by the running stack` : '',
  ];
  return { name: 'Ports', status: 'pass', detail: parts.filter(Boolean).join('; ') };
}

async function runningServicesOrNone(): Promise<Set<string>> {
  try {
    return await runningServices();
  } catch (error) {
    // Without Podman or a usable compose provider nothing of this stack can be running; the
    // container checks report those problems themselves.
    if (error instanceof CommandNotFoundError || error instanceof ComposeProviderNotFoundError) {
      return new Set();
    }
    throw error;
  }
}

// Probing by connecting, not by binding: on Windows a bind fails for minutes after the stack
// stops, while the last connections sit in TIME_WAIT — a false conflict. Only a real listener
// accepts a connection; a refused one means nothing is serving that port.
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1_000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'ECONNREFUSED'));
  });
}
