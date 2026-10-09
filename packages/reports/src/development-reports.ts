import type { NewReport, ReportRepository } from './report-repository.ts';

/**
 * Development data only (docs/19 §6): the report of the MVP acceptance script (docs/16 §4) — two
 * KPIs and two charts over the development dataset, where a click on a region filters the rest
 * (docs/14 part 1). The same report in every demo workspace, so two people with different grants
 * see different numbers in it.
 */
export const DEMO_REPORT = {
  name: 'Ventas',
  pages: [
    {
      name: 'Resumen',
      // In reading order — top to bottom, left to right — as a report is read back.
      visuals: [
        {
          position: { x: 0, y: 0, width: 4, height: 2 },
          spec: {
            version: 1,
            kind: 'kpi',
            measures: ['sales_orders.total_amount'],
            dimensions: [],
          },
        },
        {
          position: { x: 4, y: 0, width: 8, height: 4 },
          spec: {
            version: 1,
            kind: 'bar',
            measures: ['sales_orders.total_amount'],
            dimensions: ['sales_orders.region'],
            encoding: { category: 'sales_orders.region' },
          },
        },
        {
          position: { x: 0, y: 2, width: 4, height: 2 },
          spec: {
            version: 1,
            kind: 'kpi',
            measures: ['sales_orders.order_count'],
            dimensions: [],
          },
        },
        {
          position: { x: 0, y: 4, width: 12, height: 4 },
          spec: {
            version: 1,
            kind: 'line',
            measures: ['sales_orders.total_amount'],
            dimensions: ['sales_orders.order_date'],
            encoding: { category: 'sales_orders.order_date', granularity: 'month' },
          },
        },
      ],
    },
  ],
} as const satisfies Omit<NewReport, 'workspaceId' | 'createdBy'>;

/**
 * Build step 7: the activity of the GitHub repositories this machine ingests — two KPIs and three
 * charts, where a click on an event type or a repository filters the rest. Who sees which
 * repository is the `repository` grant, as `region` is for sales.
 */
export const DEMO_GITHUB_REPORT = {
  name: 'Actividad en GitHub',
  pages: [
    {
      name: 'Resumen',
      visuals: [
        {
          position: { x: 0, y: 0, width: 4, height: 2 },
          spec: {
            version: 1,
            kind: 'kpi',
            measures: ['github_events.event_count'],
            dimensions: [],
          },
        },
        {
          position: { x: 4, y: 0, width: 8, height: 4 },
          spec: {
            version: 1,
            kind: 'bar',
            measures: ['github_events.event_count'],
            dimensions: ['github_events.event_type'],
            encoding: { category: 'github_events.event_type' },
          },
        },
        {
          position: { x: 0, y: 2, width: 4, height: 2 },
          spec: {
            version: 1,
            kind: 'kpi',
            measures: ['github_events.contributor_count'],
            dimensions: [],
          },
        },
        {
          position: { x: 0, y: 4, width: 5, height: 4 },
          spec: {
            version: 1,
            kind: 'bar',
            measures: ['github_events.event_count'],
            dimensions: ['github_events.repository'],
            encoding: { category: 'github_events.repository' },
          },
        },
        {
          position: { x: 5, y: 4, width: 7, height: 4 },
          spec: {
            version: 1,
            kind: 'line',
            measures: ['github_events.event_count'],
            dimensions: ['github_events.created_at'],
            encoding: { category: 'github_events.created_at', granularity: 'day' },
          },
        },
      ],
    },
  ],
} as const satisfies Omit<NewReport, 'workspaceId' | 'createdBy'>;

/** Every demo report, in every demo workspace. */
export const DEMO_REPORTS: readonly Omit<NewReport, 'workspaceId' | 'createdBy'>[] = [
  DEMO_REPORT,
  DEMO_GITHUB_REPORT,
];

export interface DemoReportRow {
  workspaceId: string;
  name: string;
  reportId: string;
  created: boolean;
}

/**
 * Idempotent: creates each demo report where a workspace has none by that name, and leaves an
 * existing one as it is — `pnpm reset:local` starts over.
 */
export async function seedDemoReports(
  reports: ReportRepository,
  targets: readonly { workspaceId: string; createdBy: string }[],
): Promise<DemoReportRow[]> {
  const rows: DemoReportRow[] = [];
  for (const { workspaceId, createdBy } of targets) {
    const listed = await reports.listReports(workspaceId);
    for (const demo of DEMO_REPORTS) {
      const existing = listed.find((report) => report.name === demo.name);
      if (existing !== undefined) {
        rows.push({ workspaceId, name: demo.name, reportId: existing.id, created: false });
        continue;
      }
      const { reportId } = await reports.createReport({ ...demo, workspaceId, createdBy });
      rows.push({ workspaceId, name: demo.name, reportId, created: true });
    }
  }
  return rows;
}
