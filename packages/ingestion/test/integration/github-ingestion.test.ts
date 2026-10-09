import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type AnalyticalQueryPort, getDataContract, type IngestSummary } from '@atlasbi/contracts';
import { findDataContractViolations } from '@atlasbi/contracts-testing';
import { createAnalyticalQueryEngine } from '@atlasbi/warehouse';
import { CATALOG_TYPES, createTestLakehouse, type TestLakehouse } from '@atlasbi/warehouse/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type IngestionTarget, PRODUCED_DATA_CONTRACTS, runIngestion } from '../../src/index.ts';
import { eventsOf, type FakeGitHub, startFakeGitHub } from './support/fake-github.ts';

const A = 'acme/widgets';
const B = 'acme/gadgets';

/** Every file under a folder, recursively, with its content. */
async function filesUnder(root: string): Promise<{ file: string; content: Buffer }[]> {
  if (!existsSync(root)) {
    return [];
  }
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return { file: path.relative(root, file), content: await readFile(file) };
      }),
  );
}

for (const catalogType of CATALOG_TYPES) {
  describe(`pnpm ingest github, into the landing (${catalogType} catalog)`, () => {
    let lakehouse: TestLakehouse;
    let github: FakeGitHub;
    let dataDirectory: string;
    let reader: AnalyticalQueryPort;
    const target = (overrides: Partial<IngestionTarget> = {}): IngestionTarget => ({
      lakehouse: lakehouse.settings,
      dataDirectory,
      github: { repositories: [A, B], apiUrl: github.apiUrl, token: github.token },
      ...overrides,
    });
    const ingest = (overrides: Partial<IngestionTarget> = {}) =>
      runIngestion('github', target(overrides), { output: 'capture', requestAttempts: 1 });
    const landing = async () =>
      (
        await reader.query(
          'SELECT event_id, event_type, repository, actor, created_at, _load_id, _loaded_at FROM lake.landing_github.repo_events ORDER BY event_id',
        )
      ).rows;

    beforeAll(async () => {
      lakehouse = await createTestLakehouse(catalogType);
      github = await startFakeGitHub(`github_pat_${randomUUID().replaceAll('-', '')}`);
      dataDirectory = await mkdtemp(path.join(tmpdir(), 'atlasbi-ingestion-'));
      reader = await createAnalyticalQueryEngine(lakehouse.readerSettings);
    });

    afterAll(async () => {
      await reader?.close();
      await github?.close();
      await lakehouse?.dispose();
      await rm(dataDirectory, { recursive: true, force: true });
    });

    afterEach(() => {
      github.failure = undefined;
    });

    const conformance = async () =>
      Promise.all(
        PRODUCED_DATA_CONTRACTS.map(({ id, major }) =>
          findDataContractViolations(reader, getDataContract(id, major), { catalog: 'lake' }),
        ),
      );

    it('publishes the landing typed and empty before the first load, without asking the source', async () => {
      const run = await runIngestion(
        'github',
        { lakehouse: lakehouse.settings, dataDirectory },
        { output: 'capture', landingOnly: true },
      );

      expect(run.summary, run.stderr).toMatchObject({
        status: 'succeeded',
        loads: [],
        landing: [
          { table: { schema: 'landing_github', name: 'repo_events' }, rowsAdded: 0, rowsTotal: 0 },
        ],
      });
      expect(github.requests).toEqual([]);
      expect(await conformance()).toEqual([[]]);
    });

    it('loads every repository, then only what is new — each event once, in completed loads', async () => {
      github.events.set(A, eventsOf(A, 3));
      github.events.set(B, eventsOf(B, 2));

      const first = await ingest();

      expect(first.summary, first.stderr).toMatchObject({
        status: 'succeeded',
        exitCode: 0,
        retryable: false,
        loads: [
          { entity: 'repo_events', partition: A, rows: 3 },
          { entity: 'repo_events', partition: B, rows: 2 },
        ],
        landing: [
          { table: { schema: 'landing_github', name: 'repo_events' }, rowsAdded: 5, rowsTotal: 5 },
        ],
      });
      const rows = await landing();
      expect(rows.map((row) => [row[0], row[1], row[2]])).toEqual([
        [`${B}#1`, 'IssuesEvent', B],
        [`${B}#2`, 'WatchEvent', B],
        [`${A}#1`, 'IssuesEvent', A],
        [`${A}#2`, 'WatchEvent', A],
        [`${A}#3`, 'PushEvent', A],
      ]);
      expect(rows.every((row) => typeof row[5] === 'string' && row[6] !== null)).toBe(true);

      github.events.set(A, [
        ...eventsOf(A, 1, { from: 3, newest: '2026-10-07T13:00:00Z' }),
        ...eventsOf(A, 3),
      ]);
      const second = await ingest();

      expect(second.summary.loads).toEqual([
        { entity: 'repo_events', partition: A, loadId: expect.any(String) as string, rows: 1 },
        { entity: 'repo_events', partition: B, loadId: null, rows: 0 },
      ]);
      expect(second.summary.landing[0]).toMatchObject({ rowsAdded: 1, rowsTotal: 6 });
      expect((await landing()).map((row) => row[0])).toContain(`${A}#4`);
    });

    it('publishes the landing as its data contract says, with the data (docs/21 §2.4)', async () => {
      expect(await conformance()).toEqual([[]]);

      const republished = await runIngestion(
        'github',
        { lakehouse: lakehouse.settings, dataDirectory },
        { output: 'capture', landingOnly: true },
      );
      expect(republished.summary.landing[0]).toMatchObject({ rowsAdded: 0, rowsTotal: 6 });
    });

    it('types the landing as its contract says, whatever reader opens it', async () => {
      const { columns } = await reader.query(
        'SELECT * FROM lake.landing_github.repo_events LIMIT 0',
      );

      expect(columns.map((column) => [column.name, column.type.kind])).toEqual([
        ['event_id', 'varchar'],
        ['event_type', 'varchar'],
        ['repository', 'varchar'],
        ['actor', 'varchar'],
        ['created_at', 'timestamp_tz'],
        ['_load_id', 'varchar'],
        ['_loaded_at', 'timestamp_tz'],
      ]);
    });

    it('answers each failure with its code, and retries only what can work unchanged', async () => {
      const outcome = (summary: IngestSummary) => [
        summary.exitCode,
        summary.error?.code,
        summary.retryable,
      ];

      github.failure = { status: 401 };
      expect(outcome((await ingest()).summary)).toEqual([77, 'credentials_refused', false]);
      github.failure = { status: 403, rateLimited: true };
      expect(outcome((await ingest()).summary)).toEqual([75, 'source_unavailable', true]);
      github.failure = { status: 503 };
      expect(outcome((await ingest()).summary)).toEqual([75, 'source_unavailable', true]);
      github.failure = undefined;
      expect(
        outcome(
          (
            await ingest({
              github: {
                repositories: ['acme/missing'],
                apiUrl: github.apiUrl,
                token: github.token,
              },
            })
          ).summary,
        ),
      ).toEqual([78, 'configuration_error', false]);
      expect(
        outcome(
          (
            await ingest({
              github: { repositories: [A], apiUrl: 'http://127.0.0.1:1', token: github.token },
            })
          ).summary,
        ),
      ).toEqual([75, 'source_unavailable', true]);
    });

    it('refuses a load whose types changed, and keeps nothing of it (data types are frozen)', async () => {
      const before = (await landing()).length;
      github.events.set(B, [
        // Not 'yes': dlt coerces that to a boolean, so it is no type change at all (measured).
        {
          ...eventsOf(B, 1, { from: 2, newest: '2026-10-07T14:00:00Z', types: ['WatchEvent'] })[0]!,
          public: 'not a boolean',
        },
        ...eventsOf(B, 2),
      ]);

      const run = await ingest({
        github: { repositories: [B], apiUrl: github.apiUrl, token: github.token },
      });

      expect([run.summary.exitCode, run.summary.error?.code]).toEqual([65, 'schema_change']);
      expect(run.summary.error?.message).toContain(B);
      expect((await landing()).length).toBe(before);
    });

    it('never shows a secret: not in the summary, the output, its files or the landing', async () => {
      const secrets = [github.token];
      if (lakehouse.settings.storage.kind === 's3') {
        secrets.push(lakehouse.settings.storage.secretAccessKey);
      }
      if (lakehouse.settings.catalog.type === 'postgres') {
        secrets.push(
          decodeURIComponent(new URL(lakehouse.settings.catalog.connectionString).password),
        );
      }
      github.failure = { status: 401 };
      const failed = await ingest();
      github.failure = undefined;
      const succeeded = await ingest();

      const texts = [
        JSON.stringify(failed.summary),
        failed.stderr,
        JSON.stringify(succeeded.summary),
        succeeded.stderr,
        JSON.stringify(await landing()),
      ];
      for (const secret of secrets) {
        for (const text of texts) {
          expect(text.includes(secret)).toBe(false);
        }
        for (const { file, content } of await filesUnder(dataDirectory)) {
          expect(content.includes(secret), file).toBe(false);
        }
      }
    });
  });
}

// A recreated lakehouse — `pnpm reset:local` + `pnpm bootstrap` keeps .data/ingestion — must not
// inherit the incremental cursors of the one it replaces, or it would load only what is newer than
// them (SQLMesh's state had that trap, build step 2). dlt avoids it on its own: with no pipeline
// state in the destination, it drops the local one (measured in Phase D). This pins it, so an
// upgrade that changes it fails here.
describe('the ingestion state belongs to one lakehouse', () => {
  let github: FakeGitHub;
  let dataDirectory: string;
  const lakehouses: TestLakehouse[] = [];

  beforeAll(async () => {
    github = await startFakeGitHub(`github_pat_${randomUUID().replaceAll('-', '')}`);
    github.events.set(A, eventsOf(A, 3));
    dataDirectory = await mkdtemp(path.join(tmpdir(), 'atlasbi-ingestion-'));
  });

  afterAll(async () => {
    await github?.close();
    for (const lakehouse of lakehouses) {
      await lakehouse.dispose();
    }
    await rm(dataDirectory, { recursive: true, force: true });
  });

  it('loads everything into a new lakehouse, though the same folder loaded another one before', async () => {
    for (const round of [1, 2]) {
      const lakehouse = await createTestLakehouse('sqlite');
      lakehouses.push(lakehouse);

      const run = await runIngestion(
        'github',
        {
          lakehouse: lakehouse.settings,
          dataDirectory,
          github: { repositories: [A], apiUrl: github.apiUrl, token: github.token },
        },
        { output: 'capture', requestAttempts: 1 },
      );

      expect(run.summary, `lakehouse ${round}: ${run.stderr}`).toMatchObject({
        exitCode: 0,
        landing: [{ rowsAdded: 3, rowsTotal: 3 }],
      });
    }
  });
});

describe('the user home after a run', () => {
  let lakehouse: TestLakehouse;
  let github: FakeGitHub;
  let home: string;
  let dataDirectory: string;
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

  beforeAll(async () => {
    lakehouse = await createTestLakehouse('sqlite');
    github = await startFakeGitHub(`github_pat_${randomUUID().replaceAll('-', '')}`);
    github.events.set(A, eventsOf(A, 2));
  });

  afterAll(async () => {
    await github?.close();
    await lakehouse?.dispose();
  });

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'atlasbi-home-'));
    dataDirectory = await mkdtemp(path.join(tmpdir(), 'atlasbi-ingestion-'));
    // What the runner would take for the user's home, were it not given one of its own.
    process.env.HOME = home;
    process.env.USERPROFILE = home;
  });

  afterEach(async () => {
    process.env.HOME = saved.HOME;
    process.env.USERPROFILE = saved.USERPROFILE;
    await rm(home, { recursive: true, force: true });
    await rm(dataDirectory, { recursive: true, force: true });
  });

  const ingest = () =>
    runIngestion(
      'github',
      {
        lakehouse: lakehouse.settings,
        dataDirectory,
        github: { repositories: [A], apiUrl: github.apiUrl, token: github.token },
      },
      { output: 'capture', requestAttempts: 1 },
    );

  it('creates no ~/.dlt: dlt writes its anonymous id into the ingestion folder instead', async () => {
    const run = await ingest();

    expect(run.summary.exitCode, run.stderr).toBe(0);
    expect(existsSync(path.join(home, '.dlt'))).toBe(false);
    const kept = (await filesUnder(path.join(dataDirectory, 'home'))).map(({ file }) =>
      path.basename(file),
    );
    expect(kept).toContain('.anonymous_id');
  });

  it('leaves an existing ~/.dlt empty', async () => {
    await mkdir(path.join(home, '.dlt'));

    const run = await ingest();

    expect(run.summary.exitCode, run.stderr).toBe(0);
    expect(await readdir(path.join(home, '.dlt'))).toEqual([]);
  });
});
