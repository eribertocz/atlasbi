import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  CUBE_EXTENSION_DIRECTORY,
  CUBE_IMAGE,
  probeSemanticLayer,
  SemanticLayerUnavailableError,
} from '@atlasbi/semantic';

import { runOneOffContainer } from '../container-runtime/podman.ts';
import { describeFailure } from '../lakehouse-environment.ts';
import type { LakehouseStartMode } from './lakehouse-probes.ts';
import type { ReadinessStep } from './readiness-chain.ts';
import { retryUntil, type RetryPolicy } from './retry-until.ts';

export const CUBE_EXTENSIONS_STEP = 'Cube extensions';
export const CUBE_STEP = 'Cube';

/** What Cube's DuckDB loads: DuckDB registers postgres as postgres_scanner on disk. */
const CUBE_EXTENSIONS = [
  { name: 'ducklake', file: 'ducklake.duckdb_extension' },
  { name: 'postgres', file: 'postgres_scanner.duckdb_extension' },
  { name: 'httpfs', file: 'httpfs.duckdb_extension' },
] as const;

// Cube starts in seconds, but its first answer waits for the lakehouse and the refresh worker.
const CUBE_READY: RetryPolicy = {
  timeoutMs: 120_000,
  intervalMs: 2_000,
  isRetryable: (error) => !(error instanceof SemanticLayerUnavailableError) || error.retryable,
};

// Runs inside the Cube image, with its own @duckdb/node-api: the extensions installed are exactly
// the ones its engine and platform (linux_amd64, or linux_arm64 on Apple silicon) load.
const INSTALL_SCRIPT = `
const { DuckDBInstance } = require('@duckdb/node-api');
(async () => {
  const instance = await DuckDBInstance.create(':memory:', {
    extension_directory: '${CUBE_EXTENSION_DIRECTORY}',
    autoinstall_known_extensions: 'false',
    autoload_known_extensions: 'false',
  });
  const connection = await instance.connect();
  for (const name of ${JSON.stringify(CUBE_EXTENSIONS.map((extension) => extension.name))}) {
    await connection.run('INSTALL ' + name);
  }
})().catch((error) => { console.error(error.message); process.exit(1); });
`;

/** The linux_* platform folders under the extension directory that hold every extension Cube loads. */
export async function findCubeExtensionPlatforms(extensionDirectory: string): Promise<string[]> {
  if (!existsSync(extensionDirectory)) {
    return [];
  }
  const platforms: string[] = [];
  for (const version of await readdir(extensionDirectory)) {
    const versionFolder = path.join(extensionDirectory, version);
    if (!existsSync(versionFolder) || !version.startsWith('v')) {
      continue;
    }
    for (const platform of await readdir(versionFolder)) {
      const folder = path.join(versionFolder, platform);
      if (
        platform.startsWith('linux_') &&
        CUBE_EXTENSIONS.every((extension) => existsSync(path.join(folder, extension.file)))
      ) {
        platforms.push(`${version}/${platform}`);
      }
    }
  }
  return platforms;
}

/**
 * bootstrap: the extensions for Cube's container, installed next to the host's own (the only
 * download) — then Cube answering from the lakehouse. dev: the same, verified only.
 */
export function semanticReadinessSteps(options: {
  mode: LakehouseStartMode;
  extensionDirectory: string;
  cubeUrl: string;
  apiSecret: string;
}): ReadinessStep[] {
  return [
    {
      name: CUBE_EXTENSIONS_STEP,
      ensureReady: async () => {
        let platforms = await findCubeExtensionPlatforms(options.extensionDirectory);
        if (platforms.length === 0 && options.mode === 'bootstrap') {
          await installCubeExtensions(options.extensionDirectory);
          platforms = await findCubeExtensionPlatforms(options.extensionDirectory);
        }
        if (platforms.length === 0) {
          // Without them Cube cannot open the lakehouse, and says only that it is unavailable.
          throw new Error(
            options.mode === 'bootstrap'
              ? 'still missing after installing them inside the Cube image'
              : 'not installed for Cube → run `pnpm bootstrap` (needs Internet once)',
          );
        }
        return `${CUBE_EXTENSIONS.map((extension) => extension.name).join(', ')} (${platforms.join(', ')})`;
      },
    },
    {
      name: CUBE_STEP,
      dependsOn: ['Lakehouse', CUBE_EXTENSIONS_STEP],
      ensureReady: async () => {
        try {
          await retryUntil(
            () => probeSemanticLayer({ url: options.cubeUrl, apiSecret: options.apiSecret }),
            CUBE_READY,
          );
          return 'healthy — answers from the lakehouse as its reader';
        } catch (error) {
          throw new Error(describeFailure(error), { cause: error });
        }
      },
    },
  ];
}

async function installCubeExtensions(extensionDirectory: string): Promise<void> {
  const result = await runOneOffContainer({
    image: CUBE_IMAGE,
    entrypoint: 'node',
    args: ['-e', INSTALL_SCRIPT],
    mounts: [{ source: path.resolve(extensionDirectory), target: CUBE_EXTENSION_DIRECTORY }],
  });
  if (result.exitCode !== 0) {
    throw new Error(`installing them inside the Cube image failed: ${result.stderr.trim()}`);
  }
}
