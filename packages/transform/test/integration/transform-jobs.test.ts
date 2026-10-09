import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { EnvSecretProvider, SECRET_KEYS } from '@atlasbi/config';
import { getDataContract } from '@atlasbi/contracts';
import { createThrowawayDatabase, type ThrowawayDatabase } from '@atlasbi/database/testing';
import { createLakehouseAdmin, seedDevelopmentDataset } from '@atlasbi/warehouse';
import {
  type ContractRowValue,
  createTestLakehouse,
  type TestLakehouse,
  writeContractView,
} from '@atlasbi/warehouse/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { runTransformJob, type TransformTarget } from '../../src/index.ts';
import { GITHUB_LANDING_ROWS, githubLandingContract } from '../support/landing-fixture.ts';
import {
  copyProject,
  extensionDirectory,
  workspaceEnvironment,
} from '../support/transform-environment.ts';

/** What the job answers to each failure the tool can meet (Plan C, Phase 0), with its exit code. */
describe('the transformation job, when something fails', () => {
  let lakehouse: TestLakehouse;
  let state: ThrowawayDatabase;
  let target: Extract<TransformTarget, { mode: 'lakehouse' }>;
  const projects: { dispose(): Promise<void> }[] = [];

  /** A copy of the project with one file changed. */
  const changedProject = async (file: string, change: (text: string) => string) => {
    const project = await copyProject();
    projects.push(project);
    const full = path.join(project.directory, file);
    await writeFile(full, change(await readFile(full, 'utf8')));
    return project.directory;
  };

  beforeAll(async () => {
    workspaceEnvironment();
    lakehouse = await createTestLakehouse('sqlite');
    state = await createThrowawayDatabase(
      await new EnvSecretProvider().get(SECRET_KEYS.databaseUrl),
    );
    const admin = await createLakehouseAdmin(lakehouse.settings);
    try {
      await seedDevelopmentDataset(admin);
      // The same event twice: the GitHub mart's unique_values audit cannot pass on this landing.
      const repeated: Record<string, ContractRowValue>[] = [
        ...GITHUB_LANDING_ROWS,
        // eslint-disable-next-line @typescript-eslint/naming-convention -- a contract column.
        { ...GITHUB_LANDING_ROWS[0], _load_id: 'load-again' },
      ];
      await writeContractView(admin, githubLandingContract(), repeated);
    } finally {
      await admin.close();
    }
    target = {
      mode: 'lakehouse',
      lakehouse: lakehouse.settings,
      stateConnectionString: state.connectionString,
    };
  });

  afterEach(async () => {
    for (const project of projects.splice(0)) {
      await project.dispose();
    }
  });

  afterAll(async () => {
    await state?.drop();
    await lakehouse?.dispose();
  });

  const outcome = (summary: { exitCode: number; error?: { code: string }; retryable: boolean }) => [
    summary.exitCode,
    summary.error?.code,
    summary.retryable,
  ];

  it('refuses a deploy whose data fails an audit — nothing of that model is published', async () => {
    const { summary, stderr } = await runTransformJob('deploy', target, { output: 'capture' });

    expect(outcome(summary), stderr).toEqual([65, 'audit_failed', false]);
    expect(summary.error?.message).toContain('marts.mart_github_repo_events');
    expect(summary.models).toContainEqual(
      expect.objectContaining({ model: 'marts.mart_github_repo_events', failed: true }),
    );
  });

  it('refuses a model that reads a column that does not exist', async () => {
    const projectDirectory = await changedProject(
      'models/staging/stg_github_repo_events.sql',
      (sql) => sql.replace('  actor,', '  actor,\n  no_such_column,'),
    );

    const { summary } = await runTransformJob('deploy', target, {
      output: 'capture',
      projectDirectory,
    });

    expect(outcome(summary)).toEqual([65, 'model_invalid', false]);
  });

  it("lists every lint violation, the platform's rules included", async () => {
    const projectDirectory = await changedProject(
      'models/staging/stg_github_repo_events.sql',
      // The ingestion's internal schema, not the landing: NoIngestionInternals refuses it.
      (sql) =>
        sql.replace(
          'FROM lake.landing_github.repo_events',
          'FROM lake.ingestion_github.push_event',
        ),
    );

    const { summary } = await runTransformJob('check', target, {
      output: 'capture',
      projectDirectory,
    });

    expect(outcome(summary)).toEqual([65, 'model_invalid', false]);
    expect(summary.lint).toContainEqual({
      rule: 'noingestioninternals',
      model: 'staging.stg_github_repo_events',
    });
  });

  it('runs the unit tests without a lakehouse, and says how many fail', async () => {
    const unitTests: TransformTarget = {
      mode: 'unit-tests',
      extensionDirectory: extensionDirectory(),
    };
    const passing = await runTransformJob('test', unitTests, { output: 'capture' });
    const projectDirectory = await changedProject(
      'tests/test_mart_github_repo_events.yaml',
      (yaml) => {
        const at = yaml.lastIndexOf('actor: ana,');
        return `${yaml.slice(0, at)}actor: someone_else,${yaml.slice(at + 'actor: ana,'.length)}`;
      },
    );
    const failing = await runTransformJob('test', unitTests, {
      output: 'capture',
      projectDirectory,
    });

    expect(passing.summary, passing.stderr).toMatchObject({ exitCode: 0, tests: { failed: 0 } });
    expect(passing.summary.tests?.run).toBeGreaterThan(1);
    expect(outcome(failing.summary)).toEqual([65, 'test_failed', false]);
    expect(failing.summary.tests?.failed).toBe(1);
  });

  it('asks for a retry when its own state database does not answer', async () => {
    const dead = new URL(state.connectionString);
    dead.port = '1';

    const { summary } = await runTransformJob(
      'run',
      { ...target, stateConnectionString: dead.toString() },
      { output: 'capture' },
    );

    expect(outcome(summary)).toEqual([75, 'state_unavailable', true]);
    expect(JSON.stringify(summary)).not.toContain(decodeURIComponent(dead.password));
  });

  it('keeps the landing contract the project declares', () => {
    expect(githubLandingContract()).toEqual(getDataContract('landing.github_repo_events', 1));
  });
});
