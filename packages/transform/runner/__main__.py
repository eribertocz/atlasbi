"""`pnpm transform <verb> [--json]` runs this (Plan C), never a person directly.

stdout carries the job summary (TransformJobSummary, @atlasbi/contracts) and nothing else:
everything the tool prints goes to stderr. The exit code is the summary's. The project folder comes
in ATLASBI_TRANSFORM_PROJECT; everything else, in the variables `pnpm transform` sets for this
process only (project/config.py).
"""

import contextlib
import json
import os
import sys
import traceback
from datetime import datetime, timezone

from .errors import EXIT_CODES, classify, classify_failures

VERBS = ("run", "deploy", "test", "check")
JOB_VERSION = "1.0"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _context(console):
    from sqlmesh import Context
    from sqlmesh.core.console import set_console

    set_console(console)
    return Context(paths=[os.environ["ATLASBI_TRANSFORM_PROJECT"]])


def _run(context, console):
    from sqlmesh.utils import CompletionStatus

    from .console import model_results

    status = context.run()
    failure = classify_failures(console.failures) if status == CompletionStatus.FAILURE else None
    return {"models": model_results(console)}, failure


def _deploy(context, console):
    from .console import model_results, table_name

    plan = context.plan(auto_apply=True, no_prompts=True)
    changed = sorted(table_name(s.name) for s in plan.new_snapshots if not s.is_external)
    return {"models": model_results(console), "changes": {"changed": plan.has_changes, "models": changed}}, None


def _test(context, console):
    outcome = context.test(stream=sys.stderr)
    failed = len(outcome.failures) + len(outcome.errors)
    result = {"models": [], "tests": {"run": outcome.testsRun, "failed": failed}}
    if failed:
        return result, ("test_failed", f"{failed} of {outcome.testsRun} model unit tests fail; the output above shows which.")
    return result, None


def _check(context, console):
    violations = context.lint_models(raise_on_error=False)
    lint = [{"rule": violation.rule.name, "model": violation.model.name} for violation in violations]
    if lint:
        # The audits check published data; a project that breaks its own rules is fixed first.
        return {"models": [], "lint": lint}, ("model_invalid", f"{len(lint)} lint violation(s): models must follow the project's rules.")
    passed = context.audit(start=None, end=None)
    result = {"models": [], "lint": lint, "audits": {"passed": passed}}
    if not passed:
        return result, ("audit_failed", "An audit fails on the data already published; the output above shows which.")
    return result, None


HANDLERS = {"run": _run, "deploy": _deploy, "test": _test, "check": _check}


def main(argv: list) -> int:
    started = _now()
    flags = {arg for arg in argv if arg.startswith("--")}
    positional = [arg for arg in argv if not arg.startswith("--")]
    verb = positional[0] if positional else ""
    result, failure = {"models": []}, None

    if len(positional) != 1 or flags - {"--json"} or verb not in VERBS:
        failure = ("usage_error", f"Usage: pnpm transform <verb> [--json] — verbs: {', '.join(VERBS)}.")
    elif os.environ.get("ATLASBI_TRANSFORM_MODE") not in ("lakehouse", "unit-tests") or not os.environ.get("ATLASBI_TRANSFORM_PROJECT"):
        failure = ("configuration_error", "Run the transformation through `pnpm transform <verb>`: it checks the lakehouse and hands over the secrets.")
    else:
        from .console import RecordingConsole, model_results

        console = RecordingConsole()
        try:
            with contextlib.redirect_stdout(sys.stderr):
                result, failure = HANDLERS[verb](_context(console), console)
        except Exception as error:  # noqa: BLE001 — every failure becomes a code and a message
            failure = classify(error, console.failures)
            result = {"models": model_results(console)}
            if os.environ.get("ATLASBI_TRANSFORM_DEBUG") == "1":
                traceback.print_exc(file=sys.stderr)

    exit_code = EXIT_CODES[failure[0]] if failure else 0
    summary = {
        "jobVersion": JOB_VERSION,
        "verb": verb,
        "status": "failed" if failure else "succeeded",
        "exitCode": exit_code,
        "retryable": exit_code == 75,
        "startedAt": started,
        "finishedAt": _now(),
        **result,
        **({"error": {"code": failure[0], "message": failure[1]}} if failure else {}),
    }
    if "--json" in flags:
        print(json.dumps(summary), flush=True)
    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
