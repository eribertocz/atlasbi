-- Authorization owned by the platform (docs/09 §6.1–§6.2), next to better-auth, never inside it:
-- what someone can DO in a workspace (workspace_membership) and what they can SEE
-- (data_entitlements) — two separate questions, resolved per request and combined only in the
-- security context.

create schema access;

create table access.workspace (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references auth.organization (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table access.workspace_membership (
  workspace_id uuid not null references access.workspace (id) on delete cascade,
  user_id uuid not null references auth."user" (id) on delete cascade,
  role text not null check (role in ('admin', 'editor', 'analyst', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_membership_user_id_idx on access.workspace_membership (user_id);

create table access.data_entitlements (
  workspace_id uuid not null,
  user_id uuid not null,
  -- A dimension the semantic layer can protect (`region`…), never a workspace role.
  dimension text not null check (dimension ~ '^[a-z][a-z0-9_]*$'),
  all_values boolean not null default false,
  allowed_values text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id, dimension),
  -- What someone can see belongs to their membership: removing it removes this too.
  foreign key (workspace_id, user_id)
    references access.workspace_membership (workspace_id, user_id) on delete cascade,
  -- "All values" is an explicit grant; a listed grant is never empty (docs/09 §6.1, decision D3).
  check (
    (all_values and cardinality(allowed_values) = 0)
    or (not all_values and cardinality(allowed_values) > 0)
  ),
  check (array_position(allowed_values, null) is null)
);
