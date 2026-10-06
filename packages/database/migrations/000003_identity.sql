-- Identity owned by the platform (layer-isolation audit, option 1; docs/09 §6.4): who exists —
-- people and organizations — in tables of the platform's own, so authorization (`access`) never
-- references an identity provider's tables. The provider keeps credentials and sessions; its
-- adapter writes these rows next to every account it creates, and `pnpm identity:reconcile`
-- repairs what is missing.

create schema identity;

-- An organization: the tenant every workspace belongs to.
create table identity.organization (
  id uuid primary key,
  created_at timestamptz not null default now()
);

-- A person the platform knows, whatever provider signs them in.
create table identity.principal (
  id uuid primary key,
  created_at timestamptz not null default now()
);

-- Which provider account is which principal. A provider that keeps its own ids (Keycloak…) maps
-- them here; better-auth's user id is the principal id itself.
create table identity.provider_subject (
  provider text not null check (provider ~ '^[a-z][a-z0-9-]*$'),
  subject text not null check (length(subject) > 0),
  principal_id uuid not null references identity.principal (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider, subject)
);

create index provider_subject_principal_id_idx on identity.provider_subject (principal_id);

-- One-time transition from build step 4, when better-auth was the only record of who exists. The
-- last time a platform migration reads the provider's tables.
insert into identity.organization (id, created_at)
select id, "createdAt" from auth.organization;

insert into identity.principal (id, created_at)
select id, "createdAt" from auth."user";

insert into identity.provider_subject (provider, subject, principal_id, created_at)
select 'better-auth', id::text, id, "createdAt" from auth."user";

-- Authorization now points at the platform's identity, never at the provider's.
alter table access.workspace
  drop constraint workspace_organization_id_fkey,
  add constraint workspace_organization_id_fkey
    foreign key (organization_id) references identity.organization (id) on delete cascade;

alter table access.workspace_membership
  drop constraint workspace_membership_user_id_fkey,
  add constraint workspace_membership_user_id_fkey
    foreign key (user_id) references identity.principal (id) on delete cascade;
