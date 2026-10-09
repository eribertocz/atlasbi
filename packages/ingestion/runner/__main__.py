"""`pnpm ingest <source> [--json]` runs this (build step 7), never a person directly.

stdout carries the job summary (IngestSummary, @atlasbi/contracts) and nothing else: everything the
tool and the copied source print goes to stderr. The exit code is the summary's.

`--landing-only` loads nothing: it publishes the landing views from what is already loaded — typed
and empty before the first load — so transformation can be planned before anything is ingested
(`pnpm bootstrap`).
"""

import contextlib
import json
import os
import sys
import traceback
from datetime import datetime, timezone

from .errors import EXIT_CODES, classify
from .settings import RunnerConfigurationError, isolate_home, read_settings

SOURCES = ("github",)
JOB_VERSION = "1.0"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def main(argv: list) -> int:
    started = _now()
    flags = {arg for arg in argv if arg.startswith("--")}
    positional = [arg for arg in argv if not arg.startswith("--")]
    as_json = "--json" in flags
    landing_only = "--landing-only" in flags
    source = positional[0] if positional else ""
    loads, landing, failure = [], [], None

    if len(positional) != 1 or flags - {"--json", "--landing-only"} or source not in SOURCES:
        failure = ("usage_error", f"Usage: pnpm ingest <source> [--json] — sources: {', '.join(SOURCES)}.")
    else:
        try:
            settings = read_settings(source, landing_only)
        except RunnerConfigurationError as error:
            failure = ("configuration_error", f"{error}.")
        else:
            # Before dlt is imported: it reads the home directory at import time.
            isolate_home(settings.data_directory)
            try:
                with contextlib.redirect_stdout(sys.stderr):
                    loads, landing = _publish_landing(settings) if landing_only else _ingest(settings)
            except Exception as error:  # noqa: BLE001 — every failure becomes a code and a message
                failure = classify(error)
                if os.environ.get("ATLASBI_INGEST_DEBUG") == "1":
                    traceback.print_exc(file=sys.stderr)

    code = failure[0] if failure else None
    exit_code = EXIT_CODES[code] if code else 0
    summary = {
        "jobVersion": JOB_VERSION,
        "source": source,
        "status": "failed" if failure else "succeeded",
        "exitCode": exit_code,
        "retryable": exit_code == 75,
        "startedAt": started,
        "finishedAt": _now(),
        "loads": [
            {"entity": load.entity, "partition": load.partition, "loadId": load.load_id, "rows": load.rows}
            for load in loads
        ],
        "landing": [
            {
                "table": {"schema": item.table.schema, "name": item.table.name},
                "rowsAdded": item.rows_added,
                "rowsTotal": item.rows_total,
            }
            for item in landing
        ],
        **({"error": {"code": failure[0], "message": failure[1]}} if failure else {}),
    }
    _report(summary)
    if as_json:
        print(json.dumps(summary), flush=True)
    return exit_code


def _ingest(settings):
    from .destination import ducklake_destination
    from .sources import github

    destination = ducklake_destination(settings.lakehouse)
    repository_pipelines = github.pipelines(
        settings, destination, os.path.join(settings.data_directory, "pipelines")
    )
    # Opens the lakehouse before asking the source anything: a catalog that does not answer fails
    # here, before a request is spent.
    rows_before = github.landing_rows(repository_pipelines[0][1])
    loads = github.run(settings, repository_pipelines)
    return loads, [github.publish_landing(repository_pipelines[0][1], rows_before)]


def _publish_landing(settings):
    from .destination import ducklake_destination
    from .sources import github

    pipeline = github.landing_pipeline(
        ducklake_destination(settings.lakehouse), os.path.join(settings.data_directory, "pipelines")
    )
    return [], [github.publish_landing(pipeline, github.landing_rows(pipeline))]


def _report(summary: dict) -> None:
    """For a person at a terminal: stderr, one line per load. The outcome is the caller's to tell."""
    for load in summary["loads"]:
        news = f"{load['rows']} new" if load["rows"] else "nothing new"
        print(f"{summary['source']} · {load['partition']}: {news}", file=sys.stderr)
    for item in summary["landing"]:
        table = item["table"]
        print(
            f"landing {table['schema']}.{table['name']}: +{item['rowsAdded']} ({item['rowsTotal']} in total)",
            file=sys.stderr,
        )


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
