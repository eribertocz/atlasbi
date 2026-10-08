import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createReportsDatabase,
  outcomeOf,
  type ReportsFixture,
} from './support/reports-database.ts';

const CHECK_VIOLATION = '23514';
const VALID_SPEC = {
  version: 1,
  kind: 'bar',
  measures: ['sales_orders.total_amount'],
  dimensions: ['sales_orders.region'],
  encoding: { category: 'sales_orders.region' },
};
const POSITION = { x: 0, y: 0, width: 6, height: 4 };

// Migration 000004 (docs/19 §8): what the database itself guarantees, whoever writes the rows.
describe('the reporting schema', () => {
  let fixture: ReportsFixture;
  let pageId: string;
  const insertVisual = (spec: unknown, position: unknown = POSITION) =>
    outcomeOf(
      fixture.pool,
      'INSERT INTO reporting.visual (page_id, position, visual_spec) VALUES ($1, $2, $3)',
      [pageId, JSON.stringify(position), JSON.stringify(spec)],
    );

  beforeAll(async () => {
    fixture = await createReportsDatabase();
    const { rows: reports } = await fixture.pool.query<{ id: string }>(
      `INSERT INTO reporting.report (workspace_id, name, created_by) VALUES ($1, 'R', $2) RETURNING id`,
      [fixture.workspaces.comercial, fixture.author],
    );
    const { rows: pages } = await fixture.pool.query<{ id: string }>(
      `INSERT INTO reporting.page (report_id, name, ordinal) VALUES ($1, 'P', 0) RETURNING id`,
      [reports[0]?.id],
    );
    pageId = pages[0]?.id ?? '';
  });

  afterAll(async () => {
    await fixture.pool.end();
    await fixture.database.drop();
  });

  it('points every key to a person at identity.principal and none at the provider’s auth.* (H3)', async () => {
    const { rows } = await fixture.pool.query<{ reference: string }>(
      `SELECT format('%s.%s -> %s.%s', source.relname, attribute.attname,
                     target_namespace.nspname, target.relname) AS reference
       FROM pg_constraint con
       JOIN pg_class source ON source.oid = con.conrelid
       JOIN pg_namespace source_namespace ON source_namespace.oid = source.relnamespace
       JOIN pg_class target ON target.oid = con.confrelid
       JOIN pg_namespace target_namespace ON target_namespace.oid = target.relnamespace
       JOIN pg_attribute attribute
         ON attribute.attrelid = con.conrelid AND attribute.attnum = ANY (con.conkey)
       WHERE con.contype = 'f' AND source_namespace.nspname = 'reporting'
       ORDER BY 1`,
    );

    expect(rows.map((row) => row.reference)).toEqual([
      'page.report_id -> reporting.report',
      'report.created_by -> identity.principal',
      'report.workspace_id -> access.workspace',
      'visual.page_id -> reporting.page',
      'visual.updated_by -> identity.principal',
    ]);
  });

  it('refuses a person the platform does not know, even one the provider might', async () => {
    expect(
      await outcomeOf(
        fixture.pool,
        `INSERT INTO reporting.report (workspace_id, name, created_by)
         VALUES ($1, 'R', gen_random_uuid())`,
        [fixture.workspaces.comercial],
      ),
    ).toBe('23503');
  });

  describe('visual_spec admits the visual grammar only, never a renderer’s configuration (H3)', () => {
    it('stores a spec of the grammar', async () => {
      expect(await insertVisual(VALID_SPEC)).toBe('ok');
      expect(
        await insertVisual({
          version: 1,
          kind: 'kpi',
          measures: ['sales_orders.total_amount'],
          dimensions: [],
        }),
      ).toBe('ok');
    });

    it('rejects ECharts options, as the spec or next to it', async () => {
      const option = {
        xAxis: { type: 'category', data: ['North'] },
        yAxis: { type: 'value' },
        series: [{ type: 'bar', data: [1] }],
      };
      expect(await insertVisual(option)).toBe(CHECK_VIOLATION);
      expect(await insertVisual({ ...VALID_SPEC, option })).toBe(CHECK_VIOLATION);
      expect(await insertVisual({ ...VALID_SPEC, series: option.series })).toBe(CHECK_VIOLATION);
      expect(await insertVisual({ ...VALID_SPEC, tooltip: { trigger: 'axis' } })).toBe(
        CHECK_VIOLATION,
      );
    });

    it('rejects renderer settings inside the encoding', async () => {
      const encoding = { ...VALID_SPEC.encoding, itemStyle: { opacity: 0.35 } };
      expect(await insertVisual({ ...VALID_SPEC, encoding })).toBe(CHECK_VIOLATION);
      expect(await insertVisual({ ...VALID_SPEC, encoding: 'echarts' })).toBe(CHECK_VIOLATION);
    });

    it('rejects a spec missing a part of the grammar, or not an object at all', async () => {
      const withoutMeasures = { ...VALID_SPEC, measures: undefined };
      expect(await insertVisual(withoutMeasures)).toBe(CHECK_VIOLATION);
      expect(await insertVisual({ ...VALID_SPEC, measures: 'sales_orders.total_amount' })).toBe(
        CHECK_VIOLATION,
      );
      expect(await insertVisual([VALID_SPEC])).toBe(CHECK_VIOLATION);
      expect(await insertVisual('bar')).toBe(CHECK_VIOLATION);
    });
  });

  it('keeps a position to its four numbers and nothing else', async () => {
    expect(await insertVisual(VALID_SPEC, { ...POSITION, zIndex: 3 })).toBe(CHECK_VIOLATION);
    expect(await insertVisual(VALID_SPEC, { x: 0, y: 0, width: 6 })).toBe(CHECK_VIOLATION);
    expect(await insertVisual(VALID_SPEC, { ...POSITION, x: '0' })).toBe(CHECK_VIOLATION);
  });
});
