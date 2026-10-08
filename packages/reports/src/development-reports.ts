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

export interface DemoReportRow {
  workspaceId: string;
  reportId: string;
  created: boolean;
}

/**
 * Idempotent: creates the demo report where a workspace has none by that name, and leaves an
 * existing one as it is — `pnpm reset:local` starts over.
 */
export async function seedDemoReports(
  reports: ReportRepository,
  targets: readonly { workspaceId: string; createdBy: string }[],
): Promise<DemoReportRow[]> {
  const rows: DemoReportRow[] = [];
  for (const { workspaceId, createdBy } of targets) {
    const existing = (await reports.listReports(workspaceId)).find(
      (report) => report.name === DEMO_REPORT.name,
    );
    if (existing !== undefined) {
      rows.push({ workspaceId, reportId: existing.id, created: false });
      continue;
    }
    const { reportId } = await reports.createReport({ ...DEMO_REPORT, workspaceId, createdBy });
    rows.push({ workspaceId, reportId, created: true });
  }
  return rows;
}
