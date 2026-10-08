-- The Report Document Model (docs/19 §8, build step 6): report → page → visual, the only source of
-- truth for what a report shows — no mirror table. People are the platform's own principals and
-- workspaces its own (`identity`, `access`), never an identity provider's tables.

create schema reporting;

create table reporting.report (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references access.workspace (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  -- The Report Document version it was saved with (docs/21 §2.3).
  schema_version integer not null default 1 check (schema_version >= 1),
  -- Reports belong to their workspace: removing a person who authored one is a decision of its
  -- own (reassign first), never a silent cascade.
  created_by uuid not null references identity.principal (id),
  created_at timestamptz not null default now()
);

create index report_workspace_id_idx on reporting.report (workspace_id);

create table reporting.page (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reporting.report (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  -- Where the page goes among its report's pages; `order` is an SQL keyword.
  ordinal integer not null check (ordinal >= 0),
  unique (report_id, ordinal)
);

create table reporting.visual (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references reporting.page (id) on delete cascade,
  -- Whole cells of the page grid: { x, y, width, height } and nothing else.
  position jsonb not null check (
    case
      when jsonb_typeof(position) <> 'object' then false
      else
        position ?& array['x', 'y', 'width', 'height']
        and position - array['x', 'y', 'width', 'height'] = '{}'::jsonb
        and jsonb_typeof(position -> 'x') = 'number'
        and jsonb_typeof(position -> 'y') = 'number'
        and jsonb_typeof(position -> 'width') = 'number'
        and jsonb_typeof(position -> 'height') = 'number'
    end
  ),
  -- What the visual shows, in the platform's grammar (docs/22 §2): its kind, measures, dimensions
  -- and encoding. A renderer's configuration never gets in, whoever writes the row — the
  -- repository validates the whole spec, this is the last line (decision H3 of build step 6).
  -- A missing key must fail the check, never make it NULL (which passes): hence `?&` and CASE.
  visual_spec jsonb not null check (
    case
      when jsonb_typeof(visual_spec) <> 'object' then false
      else
        visual_spec ?& array['version', 'kind', 'measures', 'dimensions']
        and visual_spec - array['version', 'kind', 'measures', 'dimensions', 'encoding']
          = '{}'::jsonb
        and jsonb_typeof(visual_spec -> 'version') = 'number'
        and jsonb_typeof(visual_spec -> 'kind') = 'string'
        and jsonb_typeof(visual_spec -> 'measures') = 'array'
        and jsonb_typeof(visual_spec -> 'dimensions') = 'array'
        and case
          when not visual_spec ? 'encoding' then true
          when jsonb_typeof(visual_spec -> 'encoding') <> 'object' then false
          else (visual_spec -> 'encoding') - array['category', 'granularity'] = '{}'::jsonb
        end
    end
  ),
  -- Optimistic concurrency (docs/14 §2.2): every change names the version it was made on.
  version bigint not null default 1 check (version >= 1),
  updated_by uuid references identity.principal (id),
  updated_at timestamptz
);

create index visual_page_id_idx on reporting.visual (page_id);
