"""GitHub (build step 7): the verified source's repository events — its one incremental resource
(build step 7, Phase 0). Issues and pull requests come from GraphQL and reload whole every time."""

import hashlib
import re
from dataclasses import dataclass
from typing import Optional

from ..landing import LandingTable, Published, count_rows, publish_view, tables_of
from ..settings import RunnerSettings

DATASET = "ingestion_github"
ENTITY = "repo_events"
LANDING = LandingTable("landing_github", "repo_events")
# A new column is accepted (the view exposes only the contract's); a changed type refuses the load
# instead of creating a parallel `__v_text` column silently (decision K5).
SCHEMA_CONTRACT = {"tables": "evolve", "columns": "evolve", "data_type": "freeze"}


@dataclass(frozen=True)
class Load:
    entity: str
    partition: str
    load_id: Optional[str]
    rows: int


class PartitionFailed(Exception):
    """Names the repository a failure belongs to; the cause is the tool's error."""

    def __init__(self, partition: str):
        super().__init__(partition)
        self.partition = partition


def pipeline_name(repository: str) -> str:
    """One pipeline per repository: the incremental cursor belongs to a pipeline and a resource,
    so two repositories in one pipeline share it and the second loads nothing (Phase 0)."""
    slug = re.sub(r"[^a-z0-9]+", "_", repository.lower()).strip("_")
    digest = hashlib.sha256(repository.encode()).hexdigest()[:8]
    return f"github_{slug}_{digest}"


def is_event_table(name: str) -> bool:
    """One table per event type (`push_event`…); nested lists (`…__payload__labels`) are not events."""
    return name.endswith("_event") and "__" not in name and not name.startswith("_dlt")


def pipelines(settings: RunnerSettings, destination, pipelines_dir: str) -> list:
    import dlt

    return [
        (repository, dlt.pipeline(
            pipeline_name=pipeline_name(repository),
            destination=destination,
            dataset_name=DATASET,
            pipelines_dir=pipelines_dir,
        ))
        for repository in settings.github.repositories
    ]


def landing_pipeline(destination, pipelines_dir: str):
    """Only to publish the landing from what is already loaded — no source settings, no request."""
    import dlt

    return dlt.pipeline(
        pipeline_name="github_landing",
        destination=destination,
        dataset_name=DATASET,
        pipelines_dir=pipelines_dir,
    )


def landing_rows(pipeline) -> Optional[int]:
    with pipeline.sql_client() as client:
        return count_rows(client, LANDING)


def run(settings: RunnerSettings, repository_pipelines: list) -> list:
    from ..vendor.github import github_repo_events, helpers

    # GitHub Enterprise, or the fake API of the tests; the copied source keeps it as a constant.
    helpers.REST_API_BASE_URL = settings.github.api_url
    loads = []
    for repository, pipeline in repository_pipelines:
        owner, name = repository.split("/", 1)
        source = github_repo_events(owner, name, access_token=settings.github.token)
        source.schema_contract = SCHEMA_CONTRACT
        try:
            info = pipeline.run(source)
        except Exception as error:
            raise PartitionFailed(repository) from error
        normalize = pipeline.last_trace.last_normalize_info if pipeline.last_trace else None
        counts = normalize.row_counts if normalize else {}
        rows = sum(count for table, count in counts.items() if is_event_table(table))
        load_id = info.loads_ids[-1] if info.loads_ids else None
        loads.append(Load(ENTITY, repository, load_id, rows))
    return loads


EMPTY_LANDING = (
    "select cast(null as varchar) as event_id, cast(null as varchar) as event_type, "
    "cast(null as varchar) as repository, cast(null as varchar) as actor, "
    "cast(null as timestamptz) as created_at, cast(null as varchar) as _load_id, "
    "cast(null as timestamptz) as _loaded_at where false"
)


def landing_select(event_tables: list) -> str:
    """Every event type, completed loads only, each event once — the newest load wins."""
    if not event_tables:
        return EMPTY_LANDING
    union = "\n  union all by name\n  ".join(
        f'select id, type, repo__name, actor__login, created_at, _dlt_load_id from {DATASET}."{table}"'
        for table in event_tables
    )
    return f"""
with completed as (
  select load_id, inserted_at from {DATASET}._dlt_loads where status = 0
), events as (
  {union}
)
select e.id as event_id, e.type as event_type, e.repo__name as repository, e.actor__login as actor,
       e.created_at, c.load_id as _load_id, c.inserted_at as _loaded_at
from events e
join completed c on c.load_id = e._dlt_load_id
qualify row_number() over (partition by e.id order by c.inserted_at desc) = 1"""


def publish_landing(pipeline, rows_before: Optional[int]) -> Published:
    """Again after every run: a new event type adds a table the view must include."""
    with pipeline.sql_client() as client:
        event_tables = [name for name in tables_of(client, DATASET) if is_event_table(name)]
        publish_view(client, LANDING, landing_select(event_tables))
        rows_total = count_rows(client, LANDING) or 0
    return Published(LANDING, max(rows_total - (rows_before or 0), 0), rows_total)
