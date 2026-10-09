"""What the run did, model by model — taken from SQLMesh's console, which is where the tool reports
it (Plan C, Phase 0). The human output still goes on: to stderr, never to stdout."""

import sys

import rich.console
from sqlmesh.core.console import TerminalConsole


class RecordingConsole(TerminalConsole):
    def __init__(self):
        super().__init__(console=rich.console.Console(file=sys.stderr))
        self.evaluations = []
        self.failures = []

    def update_snapshot_evaluation_progress(self, snapshot, interval, batch_idx, duration_ms,
                                            num_audits_passed, num_audits_failed, audit_only=False,
                                            execution_stats=None, *args, **kwargs):
        self.evaluations.append({
            "model": table_name(snapshot.name),
            "duration_ms": duration_ms,
            "audits_passed": num_audits_passed,
            "audits_failed": num_audits_failed,
        })
        return super().update_snapshot_evaluation_progress(
            snapshot, interval, batch_idx, duration_ms, num_audits_passed, num_audits_failed,
            audit_only, execution_stats, *args, **kwargs)

    def log_failed_models(self, errors):
        for error in errors:
            node = getattr(error, "node", None)
            self.failures.append({
                "model": table_name(getattr(node, "snapshot_name", "") or ""),
                "cause": error.__cause__,
            })
        return super().log_failed_models(errors)


def table_name(name: str) -> str:
    """`"lake"."marts"."mart_x"` → `marts.mart_x`: the table, without the engine's catalog alias."""
    parts = [part.strip('"') for part in name.split(".")]
    return ".".join(parts[-2:]) if len(parts) >= 2 else name.strip('"')


def model_results(console: RecordingConsole) -> list:
    """One entry per model, its intervals summed, in the order they ran."""
    results = {}
    for evaluation in console.evaluations:
        result = results.setdefault(evaluation["model"], {
            "model": evaluation["model"], "intervals": 0, "durationMs": 0,
            "auditsPassed": 0, "auditsFailed": 0, "failed": False,
        })
        result["intervals"] += 1
        if evaluation["duration_ms"] is None or result["durationMs"] is None:
            result["durationMs"] = None
        else:
            result["durationMs"] += evaluation["duration_ms"]
        result["auditsPassed"] += evaluation["audits_passed"]
        result["auditsFailed"] += evaluation["audits_failed"]
    for failure in console.failures:
        result = results.setdefault(failure["model"], {
            "model": failure["model"], "intervals": 0, "durationMs": None,
            "auditsPassed": 0, "auditsFailed": 0, "failed": True,
        })
        result["failed"] = True
    return list(results.values())
