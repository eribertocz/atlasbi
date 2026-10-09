import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createReportRepository,
  DEMO_REPORT,
  DEMO_REPORTS,
  InvalidReportError,
  type NewReport,
  type ReportRepository,
  seedDemoReports,
} from '../../src/index.ts';
import {
  createReportsDatabase,
  outcomeOf,
  type ReportsFixture,
} from './support/reports-database.ts';

const [{ spec: TOTAL_KPI }, { spec: BAR }, { spec: COUNT_KPI }] = DEMO_REPORT.pages[0].visuals;

describe('the report repository', () => {
  let fixture: ReportsFixture;
  let reports: ReportRepository;
  const draft = (name: string): NewReport => ({
    workspaceId: fixture.workspaces.comercial,
    createdBy: fixture.author,
    name,
    pages: [
      {
        name: 'Second page shown first',
        visuals: [
          // Stored out of reading order on purpose: a report is read top to bottom, left to right.
          { position: { x: 6, y: 0, width: 6, height: 2 }, spec: COUNT_KPI },
          { position: { x: 0, y: 2, width: 12, height: 4 }, spec: BAR },
          { position: { x: 0, y: 0, width: 6, height: 2 }, spec: TOTAL_KPI },
        ],
      },
      { name: 'Empty', visuals: [] },
    ],
  });

  beforeAll(async () => {
    fixture = await createReportsDatabase();
    reports = createReportRepository({ connectionString: fixture.database.connectionString });
  });

  afterAll(async () => {
    await reports.close();
    await fixture.pool.end();
    await fixture.database.drop();
  });

  it('reads back a report whole: pages in order, visuals in reading order', async () => {
    const { reportId } = await reports.createReport(draft('  Ventas Q3  '));

    const report = await reports.getReport(fixture.workspaces.comercial, reportId);

    expect(report).toMatchObject({
      id: reportId,
      workspaceId: fixture.workspaces.comercial,
      name: 'Ventas Q3',
      schemaVersion: 1,
    });
    expect(report?.pages.map((page) => page.name)).toEqual(['Second page shown first', 'Empty']);
    expect(report?.pages[0]?.visuals.map((visual) => [visual.position, visual.spec.kind])).toEqual([
      [{ x: 0, y: 0, width: 6, height: 2 }, 'kpi'],
      [{ x: 6, y: 0, width: 6, height: 2 }, 'kpi'],
      [{ x: 0, y: 2, width: 12, height: 4 }, 'bar'],
    ]);
    expect(report?.pages[0]?.visuals.every((visual) => visual.version === 1)).toBe(true);
    expect(report?.pages[0]?.visuals.map((visual) => visual.spec)).toEqual([
      TOTAL_KPI,
      COUNT_KPI,
      BAR,
    ]);
  });

  it('answers nothing for a report of another workspace, or ids that are not ids', async () => {
    const { reportId } = await reports.createReport(draft('Only in Comercial'));

    expect(await reports.getReport(fixture.workspaces.finanzas, reportId)).toBeUndefined();
    expect(await reports.getReport(fixture.workspaces.comercial, 'not-a-uuid')).toBeUndefined();
    expect(await reports.listReports('not-a-uuid')).toEqual([]);
    expect(
      (await reports.listReports(fixture.workspaces.finanzas)).map((report) => report.name),
    ).not.toContain('Only in Comercial');
  });

  it('never stores a renderer’s configuration, and writes nothing of a report it rejects (H3)', async () => {
    const report = draft('With ECharts options');
    const withOptions = {
      ...report,
      pages: [
        {
          name: 'Page',
          visuals: [
            {
              position: { x: 0, y: 0, width: 12, height: 4 },
              spec: { ...BAR, series: [{ type: 'bar' }] },
            },
          ],
        },
      ],
    } as unknown as NewReport;

    const error = await reports.createReport(withOptions).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(InvalidReportError);
    expect((error as InvalidReportError).issues).toEqual([
      expect.stringContaining(
        'page 1, visual 1: the spec: series is not part of the visual grammar',
      ),
    ]);
    expect(
      (await reports.listReports(fixture.workspaces.comercial)).map((summary) => summary.name),
    ).not.toContain('With ECharts options');
  });

  it('writes a report whole or not at all', async () => {
    const report = { ...draft('Half written'), createdBy: crypto.randomUUID() };

    await expect(reports.createReport(report)).rejects.toThrow();
    const { rows } = await fixture.pool.query(
      `SELECT 1 FROM reporting.report WHERE name = 'Half written'`,
    );
    expect(rows).toEqual([]);
  });

  it('goes with its workspace, but never silently with the person who authored it', async () => {
    const { rows } = await fixture.pool.query<{ id: string }>(
      `INSERT INTO access.workspace (organization_id, slug, name)
       SELECT organization_id, 'temporary', 'Temporary' FROM access.workspace LIMIT 1
       RETURNING id`,
    );
    const workspaceId = rows[0]?.id ?? '';
    const { reportId } = await reports.createReport({
      ...draft('Temporary'),
      workspaceId,
      createdBy: fixture.editor,
    });

    expect(
      await outcomeOf(fixture.pool, 'DELETE FROM identity.principal WHERE id = $1', [
        fixture.editor,
      ]),
    ).toBe('23503');
    await fixture.pool.query('DELETE FROM access.workspace WHERE id = $1', [workspaceId]);
    expect(await reports.getReport(workspaceId, reportId)).toBeUndefined();
    expect(
      await outcomeOf(fixture.pool, 'DELETE FROM identity.principal WHERE id = $1', [
        fixture.editor,
      ]),
    ).toBe('ok');
  });

  it('seeds each demo report once per workspace', async () => {
    const targets = [
      { workspaceId: fixture.workspaces.comercial, createdBy: fixture.author },
      { workspaceId: fixture.workspaces.finanzas, createdBy: fixture.author },
    ];

    const first = await seedDemoReports(reports, targets);
    const second = await seedDemoReports(reports, targets);

    expect(first.map((row) => [row.name, row.created])).toEqual([
      ['Ventas', true],
      ['Actividad en GitHub', true],
      ['Ventas', true],
      ['Actividad en GitHub', true],
    ]);
    expect(second).toEqual(first.map((row) => ({ ...row, created: false })));
    for (const [index, demo] of DEMO_REPORTS.entries()) {
      const row = first[DEMO_REPORTS.length + index];
      const report = await reports.getReport(targets[1]?.workspaceId ?? '', row?.reportId ?? '');
      expect(report?.pages[0]?.visuals.map((visual) => visual.spec)).toEqual(
        demo.pages[0]?.visuals.map((visual) => visual.spec),
      );
    }
  });
});
