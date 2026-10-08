import {
  InvalidVisualSpecError,
  parseVisualSpec,
  type ReportDocument,
  type ReportSummary,
  type ReportVisual,
  type VisualPosition,
  type VisualSpec,
  visualPositionIssues,
} from '@atlasbi/contracts';
import {
  CamelCasePlugin,
  type Generated,
  type JSONColumnType,
  Kysely,
  PostgresDialect,
  sql,
} from 'kysely';
import pg from 'pg';

// The `reporting` schema (migration 000004). Rows never leave this package (docs/21 §9): what
// leaves is the Report Document of @atlasbi/contracts.
interface ReportingTables {
  report: {
    id: Generated<string>;
    workspaceId: string;
    name: string;
    schemaVersion: Generated<number>;
    createdBy: string;
    createdAt: Generated<Date>;
  };
  page: {
    id: Generated<string>;
    reportId: string;
    name: string;
    ordinal: number;
  };
  visual: {
    id: Generated<string>;
    pageId: string;
    position: JSONColumnType<VisualPosition>;
    // Read as any object: a stored spec is validated again before it becomes a VisualSpec.
    visualSpec: JSONColumnType<object>;
    // bigint: pg returns it as a string.
    version: Generated<string>;
    updatedBy: string | null;
    updatedAt: Date | null;
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A report to create, whole: every page and visual in the order they are shown. */
export interface NewReport {
  workspaceId: string;
  name: string;
  /** A principal of the platform's identity (docs/09 §6.4). */
  createdBy: string;
  pages: readonly {
    name: string;
    visuals: readonly { position: VisualPosition; spec: VisualSpec }[];
  }[];
}

export class InvalidReportError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid report:\n- ${issues.join('\n- ')}`);
    this.name = 'InvalidReportError';
    this.issues = issues;
  }
}

/**
 * The Report Document Model (docs/19 §8): reports of a workspace, read whole. Whether someone may
 * read a workspace is the access directory's question, answered before this is asked.
 */
export interface ReportRepository {
  listReports(workspaceId: string): Promise<ReportSummary[]>;
  /** Undefined when the report does not exist in that workspace — another workspace's included. */
  getReport(workspaceId: string, reportId: string): Promise<ReportDocument | undefined>;
  /** In one transaction: the report exists whole, or not at all. */
  createReport(report: NewReport): Promise<{ reportId: string }>;
  /** Resolves once the repository's database answers; for readiness probes. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createReportRepository(options: { connectionString: string }): ReportRepository {
  const pool = new pg.Pool({ connectionString: options.connectionString, max: 5 });
  const db = new Kysely<ReportingTables>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  }).withSchema('reporting');

  return {
    async listReports(workspaceId) {
      if (!UUID.test(workspaceId)) {
        return [];
      }
      return db
        .selectFrom('report')
        .select(['id', 'name'])
        .where('workspaceId', '=', workspaceId)
        .orderBy('name')
        .orderBy('id')
        .execute();
    },

    async getReport(workspaceId, reportId) {
      if (!UUID.test(workspaceId) || !UUID.test(reportId)) {
        return undefined;
      }
      const report = await db
        .selectFrom('report')
        .select(['id', 'workspaceId', 'name', 'schemaVersion'])
        .where('id', '=', reportId)
        .where('workspaceId', '=', workspaceId)
        .executeTakeFirst();
      if (report === undefined) {
        return undefined;
      }
      const pages = await db
        .selectFrom('page')
        .select(['id', 'name'])
        .where('reportId', '=', reportId)
        .orderBy('ordinal')
        .execute();
      const visuals =
        pages.length === 0
          ? []
          : await db
              .selectFrom('visual')
              .select(['id', 'pageId', 'position', 'visualSpec', 'version'])
              .where(
                'pageId',
                'in',
                pages.map((page) => page.id),
              )
              .execute();
      return {
        ...report,
        pages: pages.map((page) => ({
          ...page,
          visuals: visuals
            .filter((visual) => visual.pageId === page.id)
            .map((visual): ReportVisual => ({
              id: visual.id,
              position: visual.position,
              spec: parseVisualSpec(visual.visualSpec),
              version: Number(visual.version),
            }))
            .sort(inReadingOrder),
        })),
      };
    },

    async createReport(report) {
      const pages = validate(report);
      const reportId = await db.transaction().execute(async (transaction) => {
        const { id } = await transaction
          .insertInto('report')
          .values({
            workspaceId: report.workspaceId,
            name: report.name.trim(),
            createdBy: report.createdBy,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const [ordinal, page] of pages.entries()) {
          const { id: pageId } = await transaction
            .insertInto('page')
            .values({ reportId: id, name: page.name, ordinal })
            .returning('id')
            .executeTakeFirstOrThrow();
          if (page.visuals.length > 0) {
            await transaction
              .insertInto('visual')
              .values(
                page.visuals.map((visual) => ({
                  pageId,
                  position: JSON.stringify(visual.position),
                  visualSpec: JSON.stringify(visual.spec),
                })),
              )
              .execute();
          }
        }
        return id;
      });
      return { reportId };
    },

    async ping() {
      await sql`SELECT 1`.execute(db);
    },

    async close() {
      await pool.end();
    },
  };
}

/**
 * Every problem of a new report at once. Returns its pages as they are stored: trimmed names, and
 * each spec as the grammar parses it — never the object as it came.
 */
function validate(report: NewReport): NewReport['pages'] {
  const issues: string[] = [];
  if (!UUID.test(report.workspaceId) || !UUID.test(report.createdBy)) {
    issues.push('a report needs a workspace id and the principal who creates it');
  }
  if (report.name.trim() === '') {
    issues.push('a report has a name');
  }
  if (report.pages.length === 0) {
    issues.push('a report has at least one page');
  }
  const pages = report.pages.map((page, pageIndex) => {
    if (page.name.trim() === '') {
      issues.push(`page ${pageIndex + 1}: a page has a name`);
    }
    const visuals = page.visuals.flatMap((visual, visualIndex) => {
      const label = `page ${pageIndex + 1}, visual ${visualIndex + 1}`;
      issues.push(...visualPositionIssues(visual.position).map((issue) => `${label}: ${issue}`));
      try {
        const { x, y, width, height } = visual.position;
        return [{ position: { x, y, width, height }, spec: parseVisualSpec(visual.spec) }];
      } catch (error) {
        if (!(error instanceof InvalidVisualSpecError)) {
          throw error;
        }
        issues.push(...error.issues.map((issue) => `${label}: ${issue}`));
        return [];
      }
    });
    return { name: page.name.trim(), visuals };
  });
  if (issues.length > 0) {
    throw new InvalidReportError(issues);
  }
  return pages;
}

/** Top to bottom, then left to right: the order a screen reader and a narrow screen follow. */
function inReadingOrder(a: ReportVisual, b: ReportVisual): number {
  return a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id);
}
