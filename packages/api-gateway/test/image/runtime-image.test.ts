import { execFileSync, spawnSync } from 'node:child_process';

import { beforeAll, describe, expect, it } from 'vitest';

/** The image `pnpm stack:up` builds (infra/images/api-gateway.Containerfile). */
const IMAGE = process.env.ATLASBI_GATEWAY_IMAGE ?? 'localhost/atlasbi/api-gateway:dev';
const DEVELOPMENT_TOOLING = ['typescript', 'vite', 'vitest'];

/** Runs a Node script inside the image, with no network and no configuration. */
function inImage(script: string, options: { module?: boolean } = {}): string {
  return execFileSync(
    'podman',
    [
      'run',
      '--rm',
      '--network',
      'none',
      '--entrypoint',
      'node',
      IMAGE,
      ...(options.module === true ? ['--input-type=module'] : []),
      '-e',
      script,
    ],
    { encoding: 'utf8' },
  );
}

// Build step 6, Phase C: what runs in production is the gateway and its runtime dependencies —
// never the toolchain that builds, checks or tests it.
describe('the API gateway image', () => {
  beforeAll(() => {
    if (spawnSync('podman', ['image', 'exists', IMAGE]).status !== 0) {
      throw new Error(`${IMAGE} does not exist: build it with \`pnpm stack:up\` first.`);
    }
  });

  it('contains no TypeScript, Vite or Vitest, anywhere', () => {
    const found = JSON.parse(
      inImage(`
        const fs = require('node:fs');
        const tooling = ${JSON.stringify(DEVELOPMENT_TOOLING)};
        const packageDirectory = new RegExp('node_modules/(' + tooling.join('|') + ')(/|$)');
        const storeEntry = new RegExp('^(' + tooling.join('|') + ')@');
        const found = [];
        for (const root of ['/app', '/usr/local/lib/node_modules']) {
          for (const entry of fs.readdirSync(root, { recursive: true })) {
            const path = root + '/' + entry.replaceAll('\\\\', '/');
            if (packageDirectory.test(path) || storeEntry.test(entry.split('/').at(-1))) {
              found.push(path);
            }
          }
        }
        console.log(JSON.stringify(found));
      `),
    ) as string[];

    expect(found).toEqual([]);
  });

  it('resolves none of them from the gateway either', () => {
    const resolved = JSON.parse(
      inImage(`
        const { createRequire } = require('node:module');
        const require_ = createRequire('/app/packages/api-gateway/package.json');
        console.log(JSON.stringify(${JSON.stringify(DEVELOPMENT_TOOLING)}.filter((name) => {
          try { require_.resolve(name); return true; } catch { return false; }
        })));
      `),
    ) as string[];

    expect(resolved).toEqual([]);
  });

  it('loads its TypeScript sources: the workspace packages are linked, not under node_modules', () => {
    const output = inImage(
      `const server = await import('/app/packages/api-gateway/src/gateway-server.ts');
       console.log(typeof server.buildGatewayServer);`,
      { module: true },
    );

    expect(output.trim()).toBe('function');
  });

  it('runs as an unprivileged user, and carries no .env', () => {
    const user = execFileSync(
      'podman',
      ['image', 'inspect', IMAGE, '--format', '{{.Config.User}}'],
      {
        encoding: 'utf8',
      },
    );
    const envFiles = JSON.parse(
      inImage(`
        const fs = require('node:fs');
        console.log(JSON.stringify(
          fs.readdirSync('/app', { recursive: true }).filter((entry) => /(^|[\\\\/])\\.env/.test(entry)),
        ));
      `),
    ) as string[];

    expect(user.trim()).toBe('node');
    expect(envFiles).toEqual([]);
  });
});
