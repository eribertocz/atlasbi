MODEL (
  name marts.mart_github_repo_events,
  -- Rebuilt whole, not by time range: GitHub's events reach the landing hours after they happen,
  -- so a day already processed could still gain events. Revisit with a unique-key kind, after
  -- measuring MERGE on DuckLake, at the thresholds measured in docs/versions.md (5 million rows,
  -- 30 s per rebuild or 100 MiB written per run, whichever comes first).
  kind FULL,
  cron '@daily',
  grain event_id,
  description 'Analytical result: one row per GitHub repository event — the activity of the repositories the platform ingests.',
  audits (
    not_null(columns := (event_id, event_type, repository, created_at)),
    unique_values(columns := (event_id))
  )
);

SELECT
  event_id,
  event_type,
  repository,
  actor,
  created_at
FROM staging.stg_github_repo_events
