"""A failure, in the transformation job's terms (`TransformErrorCode`, @atlasbi/contracts): a code that
decides whether to retry, and a message of the platform's own — never the tool's text, which can
repeat URLs, statements and data (Plan C, Phase 0)."""

import re
from typing import Iterator, Optional, Tuple

# Mirror of transformExitCodeFor in @atlasbi/contracts (the TypeScript side validates).
EXIT_CODES = {
    "usage_error": 64,
    "configuration_error": 78,
    "credentials_refused": 77,
    "catalog_unavailable": 75,
    "storage_unavailable": 75,
    "internal_error": 70,
    "state_unavailable": 75,
    "model_invalid": 65,
    "model_failed": 65,
    "audit_failed": 65,
    "test_failed": 65,
}

DEBUG_HINT = "run it again with ATLASBI_TRANSFORM_DEBUG=1 to see the trace"


def _chain(error: Optional[BaseException]) -> Iterator[BaseException]:
    seen = set()
    while error is not None and id(error) not in seen:
        seen.add(id(error))
        yield error
        error = error.__cause__ or error.__context__


def _names(error: Optional[BaseException]) -> set:
    return {type(item).__name__ for item in _chain(error)}


def _text(error: Optional[BaseException]) -> str:
    return " ".join(str(item) for item in _chain(error))


def classify_cause(model: str, cause: Optional[BaseException]) -> Tuple[str, str]:
    """Why one model failed while it ran: its audits, the storage, the catalog, or the model."""
    names, text = _names(cause), _text(cause)
    if "NodeAuditsErrors" in names or "AuditError" in names:
        # Measured live (Plan C, Phase C): `run` writes where the model is read, then audits — what
        # failed stays visible until the next run, which builds the pending interval again.
        return "audit_failed", (
            f"The data {model} produced fails its audits. Its interval stays pending and the next run "
            "builds it again, but what this run wrote is visible until then: fix the data or the model first."
        )
    if "HTTPException" in names or re.search(r"\bHTTP (PUT|GET|HEAD|POST|DELETE)\b", text):
        if re.search(r"\b403\b|AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch", text):
            return "credentials_refused", "The object storage refused the lakehouse writer key."
        return "storage_unavailable", "The object storage did not answer; try again later."
    if "TransactionException" in names or re.search(r"transaction conflict", text, re.IGNORECASE):
        return "catalog_unavailable", f"Another writer changed the lakehouse while {model} ran; try again."
    if "IOException" in names and re.search(r"connect|catalog", text, re.IGNORECASE):
        return "catalog_unavailable", "The lakehouse catalog did not answer; try again later."
    return "model_failed", f"{model} failed while it ran; {DEBUG_HINT}."


def classify_failures(failures: list) -> Tuple[str, str]:
    """The first failure that says the most: a retryable or a refused one before a model's own."""
    outcomes = [classify_cause(failure["model"], failure["cause"]) for failure in failures]
    for preferred in ("credentials_refused", "storage_unavailable", "catalog_unavailable", "audit_failed"):
        for outcome in outcomes:
            if outcome[0] == preferred:
                return outcome
    return outcomes[0] if outcomes else ("internal_error", f"The transformation failed; {DEBUG_HINT}.")


def classify(error: BaseException, failures: list) -> Tuple[str, str]:
    """An exception that stopped the verb, with the model failures the console saw before it."""
    names, text = _names(error), _text(error)
    if "LinterError" in names:
        return "model_invalid", "A model breaks the project's rules; `pnpm transform check` lists them."
    if re.search(r"failing test", text, re.IGNORECASE):
        return "test_failed", "A model's unit test fails; `pnpm transform test` shows which."
    if failures:
        return classify_failures(failures)
    if "OperationalError" in names and "psycopg2" in " ".join(type(e).__module__ for e in _chain(error)):
        if re.search(r"password authentication failed", text, re.IGNORECASE):
            return "credentials_refused", "The transformation's state database refused its credentials."
        return "state_unavailable", "The transformation's state database did not answer; try again later."
    if "ConfigError" in names and re.search(r"not been versioned yet", text):
        return "configuration_error", "Nothing is deployed in this lakehouse yet: run `pnpm transform deploy` first."
    if "ConfigError" in names:
        return "configuration_error", f"The transformation's configuration is wrong; {DEBUG_HINT}."
    if re.search(r"No catalog \+ schema named \"?lake", text):
        return "configuration_error", "The lakehouse could not be attached; `pnpm transform` checks it first — run it through the platform."
    return "internal_error", f"The transformation failed unexpectedly; {DEBUG_HINT}."
