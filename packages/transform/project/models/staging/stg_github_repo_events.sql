MODEL (
  name staging.stg_github_repo_events,
  kind VIEW,
  description 'GitHub repository events from their landing, one row per event. Logical only (docs/02 §6.1.1).'
);

SELECT
  event_id,
  event_type,
  repository,
  actor,
  created_at
FROM lake.landing_github.repo_events
