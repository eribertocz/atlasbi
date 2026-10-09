"""A failure, in the ingestion job's terms (`IngestErrorCode`, @atlasbi/contracts): a code that
decides whether to retry, and a message of the platform's own — never the tool's text, which can
repeat URLs and statements (build step 7, Phase 0)."""

import re
from typing import Iterator, Optional, Tuple

# Mirror of INGEST_EXIT_CODES / exitCodeFor in @atlasbi/contracts (the TypeScript side validates).
EXIT_CODES = {
    "usage_error": 64,
    "configuration_error": 78,
    "credentials_refused": 77,
    "source_unavailable": 75,
    "catalog_unavailable": 75,
    "storage_unavailable": 75,
    "schema_change": 65,
    "contract_violation": 65,
    "internal_error": 70,
}

DEBUG_HINT = "run it again with ATLASBI_INGEST_DEBUG=1 to see the trace"


def _chain(error: BaseException) -> Iterator[BaseException]:
    seen = set()
    stack = [error]
    while stack:
        current = stack.pop()
        if current is None or id(current) in seen:
            continue
        seen.add(id(current))
        yield current
        stack.append(current.__cause__ or current.__context__)
        # tenacity, when retries run out: the last attempt holds the real error.
        last_attempt = getattr(current, "last_attempt", None)
        if last_attempt is not None and hasattr(last_attempt, "exception"):
            stack.append(last_attempt.exception())


def classify(error: BaseException) -> Tuple[str, str]:
    chain = list(_chain(error))
    names = {type(item).__name__ for item in chain}
    partition: Optional[str] = next(
        (getattr(item, "partition") for item in chain if hasattr(item, "partition")), None
    )
    where = f" while loading {partition}" if partition else ""

    response = next(
        (item.response for item in chain if getattr(item, "response", None) is not None and hasattr(item.response, "status_code")),
        None,
    )
    if response is not None:
        status = response.status_code
        if status == 401:
            return "credentials_refused", f"The source refused its token (HTTP 401){where}."
        if status == 429 or (status == 403 and response.headers.get("x-ratelimit-remaining") == "0"):
            return "source_unavailable", f"The source's rate limit is spent{where}; try again once it resets."
        if status == 403:
            return "credentials_refused", f"The source refused access (HTTP 403){where}: the token cannot read it."
        if status == 404:
            return "configuration_error", f"The source has no such repository, or the token cannot see it (HTTP 404){where}."
        if status >= 500 or status == 408:
            return "source_unavailable", f"The source failed to answer (HTTP {status}){where}; try again later."
        return "internal_error", f"The source answered HTTP {status}{where}; {DEBUG_HINT}."
    if names & {"ConnectionError", "Timeout", "ConnectTimeout", "ReadTimeout"} and not names & {"IOException", "HTTPException"}:
        return "source_unavailable", f"The source did not answer{where}; try again later."

    if names & {"DataValidationError"} or (
        "NormalizeJobFailed" in names and re.search(r"data_type|contract|frozen", _text(chain), re.IGNORECASE)
    ):
        return "schema_change", f"The source changed a column's type{where}: that load was refused, as data types are frozen."

    engine = _engine_text(chain)
    if re.search(r"password authentication failed|authentication failed", engine, re.IGNORECASE):
        return "credentials_refused", "The lakehouse catalog refused its credentials."
    if "HTTPException" in names or re.search(r"\bHTTP (PUT|GET|HEAD|POST|DELETE)\b", engine):
        if re.search(r"\b403\b|AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch", engine):
            return "credentials_refused", "The object storage refused the lakehouse writer key."
        return "storage_unavailable", "The object storage did not answer; try again later."
    if "TransactionException" in names or re.search(r"transaction conflict", engine, re.IGNORECASE):
        return "catalog_unavailable", "Another writer changed the lakehouse at the same time; try again."
    if names & {"DestinationConnectionError", "IOException"}:
        return "catalog_unavailable", "The lakehouse catalog did not answer; try again later."
    return "internal_error", f"The ingestion failed unexpectedly{where}; {DEBUG_HINT}."


def _text(chain) -> str:
    return " ".join(str(item) for item in chain)


def _engine_text(chain) -> str:
    """DuckDB's own messages: they name the protocol and the status of a failed request."""
    return " ".join(
        str(item) for item in chain if type(item).__module__.split(".")[0] in ("_duckdb", "duckdb")
    )
