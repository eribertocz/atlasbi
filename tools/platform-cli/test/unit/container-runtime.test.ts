import { describe, expect, it } from 'vitest';

import {
  evaluateComposeProvider,
  evaluatePodmanVersion,
} from '../../src/checks/container-checks.ts';
import {
  parseComposeProviderPath,
  parseMachineList,
  parseRunningServices,
} from '../../src/container-runtime/podman.ts';

describe('podman output parsing', () => {
  it('extracts and unescapes the provider path exactly as Podman 5.8 prints it on Windows', () => {
    // Captured from a real run: Podman doubles every backslash in the message.
    const stderr = String.raw`>>>> Executing external compose provider "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker-compose.exe". Please see podman-compose(1) for how to disable this message. <<<<`;

    expect(parseComposeProviderPath(stderr)).toBe(
      String.raw`C:\Program Files\Docker\Docker\resources\bin\docker-compose.exe`,
    );
  });

  it('reads running services from both JSON array and JSON-lines output', () => {
    const lines =
      '{"Service":"postgres","State":"running"}\n{"Service":"otel-collector","State":"exited"}';
    const array = '[{"Service":"postgres","State":"running"}]';

    expect([...parseRunningServices(lines)]).toEqual(['postgres']);
    expect([...parseRunningServices(array)]).toEqual(['postgres']);
    expect(parseRunningServices('').size).toBe(0);
  });

  it('reads machine state', () => {
    expect(parseMachineList('[{"Name":"podman-machine-default","Running":false}]')).toEqual([
      { name: 'podman-machine-default', running: false },
    ]);
  });
});

describe('container prerequisite evaluation', () => {
  it('requires Podman 5 or newer', () => {
    expect(evaluatePodmanVersion('podman version 6.1.2').status).toBe('pass');
    expect(evaluatePodmanVersion('podman version 4.9.4').status).toBe('fail');
  });

  it('accepts the standalone docker-compose provider', () => {
    const result = evaluateComposeProvider({
      providerPath: 'C:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps\\docker-compose.exe',
      versionOutput: 'Docker Compose version v5.5.1',
    });

    expect(result.status).toBe('pass');
  });

  it("rejects Docker Desktop's bundled docker-compose, from the real Podman output", () => {
    const stderr = String.raw`>>>> Executing external compose provider "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker-compose.exe". Please see podman-compose(1) for how to disable this message. <<<<`;

    const result = evaluateComposeProvider({
      providerPath: parseComposeProviderPath(stderr),
      versionOutput: 'Docker Compose version v2.35.1-desktop.1',
    });

    expect(result.status).toBe('fail');
  });

  it("rejects Docker Desktop's cli-plugins copy by its -desktop version suffix", () => {
    const result = evaluateComposeProvider({
      providerPath: String.raw`D:\Tools\docker-compose.exe`,
      versionOutput: 'Docker Compose version v2.35.1-desktop.1',
    });

    expect(result.status).toBe('fail');
  });

  it('rejects a provider other than docker-compose', () => {
    const result = evaluateComposeProvider({
      providerPath: '/usr/bin/podman-compose',
      versionOutput: 'podman-compose version 1.5.0',
    });

    expect(result.status).toBe('fail');
  });

  it('fails when podman compose has no provider at all', () => {
    expect(evaluateComposeProvider({ providerPath: undefined, versionOutput: '' }).status).toBe(
      'fail',
    );
  });
});
