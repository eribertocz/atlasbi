import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CUBE_IMAGE, CUBE_STORE_IMAGE } from '@atlasbi/semantic';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkCubeExtensions } from '../../src/checks/lakehouse-checks.ts';
import {
  CUBE_EXTENSIONS_STEP,
  findCubeExtensionPlatforms,
  semanticReadinessSteps,
} from '../../src/health/semantic-probes.ts';
import {
  LOCAL_TIER_SERVICES,
  PORTABLE_TIER_SERVICES,
  portsByService,
  readLocalInfraPorts,
  stackServices,
} from '../../src/local-environment.ts';
import { WORKSPACE_FILES } from '../../src/workspace-paths.ts';

const CUBE_FILES = [
  'ducklake.duckdb_extension',
  'postgres_scanner.duckdb_extension',
  'httpfs.duckdb_extension',
];

async function install(root: string, platform: string, files: readonly string[]): Promise<void> {
  const folder = path.join(root, 'v1.5.5', platform);
  await mkdir(folder, { recursive: true });
  for (const file of files) {
    await writeFile(path.join(folder, file), '');
  }
}

describe("Cube's extensions", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'atlasbi-cli-cube-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('are found only in a linux_* folder that holds all three', async () => {
    await install(root, 'windows_amd64', CUBE_FILES);
    await install(root, 'linux_arm64', CUBE_FILES.slice(0, 2));
    await install(root, 'linux_amd64', CUBE_FILES);

    await expect(findCubeExtensionPlatforms(root)).resolves.toEqual(['v1.5.5/linux_amd64']);
  });

  it('make preflight warn, never fail, before bootstrap installs them', async () => {
    const missing = path.join(root, 'not-yet');

    await expect(findCubeExtensionPlatforms(missing)).resolves.toEqual([]);
    await expect(checkCubeExtensions(missing)).resolves.toMatchObject({ status: 'warn' });
    await install(root, 'linux_amd64', CUBE_FILES);
    await expect(checkCubeExtensions(root)).resolves.toMatchObject({
      status: 'pass',
      detail: 'v1.5.5/linux_amd64',
    });
  });

  it('fail the dev step at once, with the remedy, instead of letting Cube time out', async () => {
    const [extensions, cube] = semanticReadinessSteps({
      mode: 'dev',
      extensionDirectory: root,
      cubeUrl: 'http://127.0.0.1:1',
      apiSecret: 'unused',
    });

    await expect(extensions?.ensureReady()).rejects.toThrow(/run `pnpm bootstrap`/);
    expect(cube?.dependsOn).toEqual(['Lakehouse', CUBE_EXTENSIONS_STEP]);
  });
});

describe('stack services per tier', () => {
  it('starts neither the object storage nor Cube for the portable tier', () => {
    expect(stackServices({ ATLASBI_LAKEHOUSE_CATALOG_TYPE: 'sqlite' })).toEqual(
      PORTABLE_TIER_SERVICES,
    );
    expect(stackServices({})).toEqual(LOCAL_TIER_SERVICES);
    expect(Object.keys(portsByService(readLocalInfraPorts({}), PORTABLE_TIER_SERVICES))).toEqual([
      'postgres',
      'otel-collector',
    ]);
    expect(portsByService(readLocalInfraPorts({})).cube).toEqual([4000, 15432]);
  });

  it('match compose.yaml: its services, and the Cube images pinned by digest', async () => {
    const compose = await readFile(WORKSPACE_FILES.composeFile, 'utf8');
    const servicesBlock = /^services:\n([\s\S]*?)^\S/m.exec(compose)?.[1] ?? '';
    const services = [...servicesBlock.matchAll(/^ {2}([a-z-]+):$/gm)].map((match) => match[1]);

    expect(services).toEqual([...LOCAL_TIER_SERVICES]);
    expect(compose).toContain(`image: ${CUBE_IMAGE}\n`);
    expect(compose).toContain(`image: ${CUBE_STORE_IMAGE}\n`);
  });
});
