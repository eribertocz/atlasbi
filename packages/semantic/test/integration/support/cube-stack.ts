import { execFile } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import type { LakehouseSettings } from '@atlasbi/warehouse';
import pg from 'pg';

import {
  CUBE_CONFIG_DIRECTORY,
  CUBE_EXTENSION_DIRECTORY,
  CUBE_IMAGE,
  CUBE_STORE_IMAGE,
  QUERY_TOKEN,
  signQueryToken,
} from '../../../src/index.ts';

const execFileAsync = promisify(execFile);

const CUBE_FOLDER = fileURLToPath(new URL('../../../cube', import.meta.url));
// compose.yaml's internal network: Cube reaches postgres:5432 and object-storage:3900 on it, and
// nothing outside the stack — exactly like the stack's own Cube. `pnpm dev` must be running.
const STACK_NETWORK = 'atlasbi_semantic';

/** Everything, every region: an explicit `region:all` grant (src/query-claims.ts). */
export const ALL_REGIONS = { sub: 'test-all-regions', groups: ['region:all'] };

export interface LoadResponse {
  status: number;
  error?: string;
  data?: Record<string, string | null>[];
  usedPreAggregations?: Record<string, unknown>;
}

export interface CubeStack {
  restUrl: string;
  sqlPort: number;
  apiSecret: string;
  /** A query token signed the platform's way, for these claims. */
  token(claims: object, lifetimeSeconds?: number): string;
  /**
   * A REST load with a query token for `claims` (all regions by default), or with the given raw
   * Authorization value; waits through "Continue wait" like any Cube client does.
   */
  load(query: unknown, auth?: object | string): Promise<LoadResponse>;
  /** A SQL API client whose password is the given query token — the SQL API has no other. */
  sqlClient(password: string): pg.Client;
  readyzStatus(): Promise<number>;
  /** Exit code of a command run inside the Cube container. */
  exec(command: readonly string[]): Promise<number>;
  logs(): Promise<string>;
  stop(): Promise<void>;
}

/**
 * A Cube and a Cube Store of their own, never the stack's: configured like compose.yaml's `cube`
 * service, with random secrets and random host ports, reading `reader` from inside the stack
 * network. Secrets reach the containers through the environment of the podman process, never
 * its command line. Resolves once /readyz answers — whatever it answers.
 */
export async function startCubeStack(reader: LakehouseSettings): Promise<CubeStack> {
  if (reader.catalog.type !== 'postgres' || reader.storage.kind !== 's3') {
    throw new Error('Cube reads the postgres tier only: a postgres catalog and S3 storage');
  }
  const id = randomUUID().slice(0, 8);
  const cubeName = `atlasbi-test-cube-${id}`;
  const cubeStoreName = `atlasbi-test-cube-store-${id}`;
  const apiSecret = randomBytes(32).toString('hex');
  const storage = reader.storage;

  const stop = async () => {
    await podman(['rm', '--force', '--volumes', cubeName, cubeStoreName]).catch(() => undefined);
  };
  try {
    await podman([
      'run',
      '--detach',
      '--name',
      cubeStoreName,
      '--network',
      STACK_NETWORK,
      '--env',
      'CUBESTORE_DATA_DIR=/cube/data/local',
      '--env',
      'CUBESTORE_REMOTE_DIR=/cube/data/remote',
      '--env',
      'CUBESTORE_TELEMETRY=false',
      CUBE_STORE_IMAGE,
    ]);
    const environment: Record<string, string> = {
      NODE_ENV: 'production',
      CUBEJS_DEV_MODE: 'false',
      CUBEJS_TELEMETRY: 'false',
      CUBEJS_DB_TYPE: 'duckdb',
      CUBEJS_API_SECRET: apiSecret,
      CUBEJS_PG_SQL_PORT: '15432',
      CUBEJS_CUBESTORE_HOST: cubeStoreName,
      CUBEJS_REFRESH_WORKER: 'true',
      ATLASBI_LAKEHOUSE_CATALOG_READER_URL: reader.catalog.connectionString,
      ATLASBI_LAKEHOUSE_CATALOG_HOST: 'postgres',
      ATLASBI_LAKEHOUSE_CATALOG_PORT: '5432',
      ATLASBI_LAKEHOUSE_S3_URL: storage.url,
      ATLASBI_LAKEHOUSE_S3_ENDPOINT: 'object-storage:3900',
      ATLASBI_LAKEHOUSE_S3_REGION: storage.region,
      ATLASBI_LAKEHOUSE_S3_USE_SSL: String(storage.useSsl),
      ATLASBI_LAKEHOUSE_S3_READER_ACCESS_KEY_ID: storage.accessKeyId,
      ATLASBI_LAKEHOUSE_S3_READER_SECRET_ACCESS_KEY: storage.secretAccessKey,
    };
    await podman(
      [
        'run',
        '--detach',
        '--name',
        cubeName,
        '--network',
        STACK_NETWORK,
        ...Object.keys(environment).flatMap((name) => ['--env', name]),
        '--mount',
        `type=bind,src=${CUBE_FOLDER},dst=${CUBE_CONFIG_DIRECTORY},ro`,
        '--mount',
        `type=bind,src=${reader.extensionDirectory},dst=${CUBE_EXTENSION_DIRECTORY},ro`,
        '--publish',
        '127.0.0.1::4000',
        '--publish',
        '127.0.0.1::15432',
        CUBE_IMAGE,
      ],
      environment,
    );
    const restUrl = `http://${await hostAddress(cubeName, 4000)}`;
    const sqlPort = Number((await hostAddress(cubeName, 15432)).split(':').at(-1));
    const token = (claims: object, lifetimeSeconds?: number) =>
      signQueryToken(apiSecret, claims, lifetimeSeconds);
    const stack: CubeStack = {
      restUrl,
      sqlPort,
      apiSecret,
      token,
      load: (query, auth = ALL_REGIONS) =>
        load(restUrl, typeof auth === 'string' ? auth : token(auth), query),
      sqlClient: (password) =>
        new pg.Client({
          host: '127.0.0.1',
          port: sqlPort,
          user: 'platform',
          password,
          database: 'db',
        }),
      readyzStatus: async () => (await fetch(`${restUrl}/readyz`)).status,
      exec: async (command) => (await podman(['exec', cubeName, ...command], {}, false)).exitCode,
      logs: async () => {
        const { stdout, stderr } = await podman(['logs', cubeName]);
        return stdout + stderr;
      },
      stop,
    };
    await waitForReadyz(stack);
    return stack;
  } catch (error) {
    await stop();
    throw error;
  }
}

/**
 * A token the platform would never sign — wrong lifetime, algorithm, audience, secret… — for the
 * negative tests. Standard claims default to the platform's; `payload` overrides them.
 */
export function forgeToken(
  secret: string,
  payload: Record<string, unknown>,
  algorithm: 'HS256' | 'HS512' = 'HS256',
): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = encode({ alg: algorithm, typ: 'JWT' });
  const body = encode({
    iss: QUERY_TOKEN.issuer,
    aud: QUERY_TOKEN.audience,
    iat: now,
    exp: now + 60,
    ...payload,
  });
  const hash = algorithm === 'HS256' ? 'sha256' : 'sha512';
  return `${head}.${body}.${createHmac(hash, secret).update(`${head}.${body}`).digest('base64url')}`;
}

async function load(restUrl: string, authorization: string, query: unknown): Promise<LoadResponse> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    const response = await fetch(`${restUrl}/cubejs-api/v1/load`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const body = (await response.json()) as Omit<LoadResponse, 'status'>;
    if (body.error !== 'Continue wait') {
      return { status: response.status, ...body };
    }
    if (Date.now() > deadline) {
      throw new Error('Cube kept answering "Continue wait"');
    }
    await delay(500);
  }
}

async function waitForReadyz(stack: CubeStack): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      await stack.readyzStatus();
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error(`Cube never answered /readyz:\n${await stack.logs()}`, { cause: error });
      }
      await delay(500);
    }
  }
}

async function hostAddress(container: string, port: number): Promise<string> {
  const { stdout } = await podman(['port', container, `${port}/tcp`]);
  const address = stdout.trim().split(/\r?\n/)[0];
  if (!address) {
    throw new Error(`${container} publishes no host port for ${port}`);
  }
  return address;
}

async function podman(
  args: readonly string[],
  environment: Record<string, string> = {},
  expectSuccess = true,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('podman', args, {
      env: { ...process.env, ...environment },
      maxBuffer: 32 * 1024 * 1024,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string };
    if (expectSuccess || typeof failure.code !== 'number') {
      throw new Error(`podman ${args[0] ?? ''} failed: ${failure.stderr?.trim() ?? ''}`, {
        cause: error,
      });
    }
    return { exitCode: failure.code, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}
