import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '@atlasbi/config';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import type { ServerOptions } from 'vite';
import { defineConfig } from 'vitest/config';

const WORKSPACE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ROOT_ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url));

/**
 * The development server: the browser's single origin (docs/19 §10), which proxies /api and /auth
 * to the gateway — with the platform's own, validated configuration, the same ports every other
 * process uses.
 */
function developmentServer(): ServerOptions {
  if (existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  const config = loadConfig(process.env, { baseDirectory: WORKSPACE_ROOT });
  const gateway = `http://127.0.0.1:${config.gateway.port}`;
  return {
    // 127.0.0.1, not `localhost`: on Windows `localhost` is IPv6 only (build step 6, Phase 0).
    host: '127.0.0.1',
    port: config.web.port,
    strictPort: true,
    proxy: { '/api': gateway, '/auth': gateway },
  };
}

// A build — and a unit test — needs no configuration at all: the build is static files any proxy
// serves.
export default defineConfig(({ command }) => ({
  plugins: [tailwindcss(), sveltekit()],
  ...(command === 'serve' && process.env.VITEST === undefined
    ? { server: developmentServer(), preview: developmentServer() }
    : {}),
  test: { environment: 'node' },
}));
