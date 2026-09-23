import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  chooseComposeProvider,
  ComposeProviderNotFoundError,
  composeProcessEnvironment,
  findComposeProvider,
  listComposeCandidates,
} from '../../src/container-runtime/compose-provider.ts';

// Real paths and `version` outputs captured on the Step 0 Windows machine, where Docker Desktop
// is installed (stopped) and its copies come first on PATH.
const DESKTOP_RESOURCES = String.raw`C:\Program Files\Docker\Docker\resources\bin\docker-compose.exe`;
const DESKTOP_CLI_PLUGINS = String.raw`C:\Program Files\Docker\cli-plugins\docker-compose.exe`;
const STANDALONE = String.raw`C:\Users\dev\AppData\Local\Microsoft\WinGet\Packages\Docker.DockerCompose_Microsoft.Winget.Source_8wekyb3d8bbwe\docker-compose.exe`;
const DESKTOP_VERSION = 'Docker Compose version v2.35.1-desktop.1';
const STANDALONE_VERSION = 'Docker Compose version v5.5.1';

describe('listComposeCandidates', () => {
  it('returns docker-compose executables in PATH order, without duplicates', () => {
    const pathValue = [
      String.raw`C:\Program Files\Docker\Docker\resources\bin`,
      String.raw`C:\Windows\system32`,
      path.win32.dirname(STANDALONE),
      String.raw`c:\program files\docker\docker\resources\bin`,
      '',
    ].join(';');
    const existing = new Set([DESKTOP_RESOURCES, STANDALONE].map((file) => file.toLowerCase()));

    const candidates = listComposeCandidates(pathValue, 'win32', (file) =>
      existing.has(file.toLowerCase()),
    );

    expect(candidates).toEqual([DESKTOP_RESOURCES, STANDALONE]);
  });

  it('uses the platform executable name and PATH delimiter', () => {
    const candidates = listComposeCandidates(
      '/usr/local/bin:/usr/bin',
      'linux',
      (file) => file === '/usr/bin/docker-compose',
    );

    expect(candidates).toEqual(['/usr/bin/docker-compose']);
  });
});

describe('chooseComposeProvider', () => {
  it('picks the standalone even when both Docker Desktop copies come first', () => {
    const { chosen, rejected } = chooseComposeProvider([
      { path: DESKTOP_RESOURCES, versionOutput: DESKTOP_VERSION },
      { path: DESKTOP_CLI_PLUGINS, versionOutput: DESKTOP_VERSION },
      { path: STANDALONE, versionOutput: STANDALONE_VERSION },
    ]);

    expect(chosen).toBe(STANDALONE);
    expect(rejected).toHaveLength(2);
  });

  it('rejects a Docker Desktop build copied outside its install folder', () => {
    const { chosen } = chooseComposeProvider([
      { path: String.raw`D:\Tools\docker-compose.exe`, versionOutput: DESKTOP_VERSION },
    ]);

    expect(chosen).toBeUndefined();
  });

  it('skips a binary whose `version` produced nothing usable', () => {
    const { chosen, rejected } = chooseComposeProvider([
      { path: String.raw`D:\Broken\docker-compose.exe`, versionOutput: '' },
      { path: STANDALONE, versionOutput: STANDALONE_VERSION },
    ]);

    expect(chosen).toBe(STANDALONE);
    expect(rejected[0]).toContain('D:\\Broken');
  });
});

describe('composeProcessEnvironment', () => {
  it('sets the provider for the child only, replacing any other spelling of the variable', () => {
    // A differently-cased spelling, as a Windows environment block may carry it.
    const lowerCaseName = 'PODMAN_COMPOSE_PROVIDER'.toLowerCase();
    const base: NodeJS.ProcessEnv = Object.fromEntries([
      ['PATH', 'x'],
      [lowerCaseName, 'stale'],
    ]);

    const environment = composeProcessEnvironment(STANDALONE, base);

    expect(environment.PODMAN_COMPOSE_PROVIDER).toBe(STANDALONE);
    expect(environment).not.toHaveProperty(lowerCaseName);
    expect(base[lowerCaseName]).toBe('stale');
  });

  it('never touches process.env', () => {
    const before = process.env.PODMAN_COMPOSE_PROVIDER;

    composeProcessEnvironment(STANDALONE);

    expect(process.env.PODMAN_COMPOSE_PROVIDER).toBe(before);
  });
});

describe('findComposeProvider with the repo-scoped override', () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'atlasbi-compose-'));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('prefers ATLASBI_COMPOSE_PROVIDER over discovery on PATH', async () => {
    const configured = path.join(folder, 'docker-compose.exe');
    await writeFile(configured, '');

    await expect(
      findComposeProvider({ ATLASBI_COMPOSE_PROVIDER: configured, PATH: '' }),
    ).resolves.toEqual({ path: configured, source: 'configured' });
  });

  it('fails clearly when the override points to a missing file', async () => {
    const missing = path.join(folder, 'missing.exe');

    const error: unknown = await findComposeProvider({ ATLASBI_COMPOSE_PROVIDER: missing }).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(ComposeProviderNotFoundError);
    expect((error as Error).message).toContain(missing);
  });

  it('reports that nothing was found when PATH has no docker-compose', async () => {
    await expect(findComposeProvider({ PATH: folder })).rejects.toBeInstanceOf(
      ComposeProviderNotFoundError,
    );
  });
});
