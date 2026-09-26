"""TEMPORARY / EXPERIMENTAL (CLAUDE.md rule 6) — DuckLake compatibility patch for SQLMesh 0.236.2.

SQLMesh drops tables and views with `DROP ... CASCADE`, and DuckLake does not implement cascading
drops ("Cascade Drop not supported in DuckLake"). Its janitor therefore can never remove an expired
model version, and every model change would leave a full physical table behind forever (measured in
Phase 0 of build step 2, docs/02 §6.1.1).

Upstream: issue SQLMesh/sqlmesh#6032, fix proposed in PR #6034 (drop TABLE/VIEW without CASCADE in
DuckLake catalogs, keep it for SCHEMA). This project only attaches DuckLake catalogs, so declaring
SCHEMA as the only cascadable kind gives the same behaviour. DuckDB views bind late: dropping a
table a view reads from is allowed.

Remove this module once the pinned SQLMesh release includes the upstream fix — the alert test
(packages/transform/test/unit/ducklake-compat.test.ts) fails on that day.
"""

from sqlmesh.core.engine_adapter.duckdb import DuckDBEngineAdapter

UPSTREAM_FIX = "https://github.com/SQLMesh/sqlmesh/pull/6034"


def upstream_fix_present() -> bool:
    """True once SQLMesh decides cascade per catalog itself, which is how PR #6034 fixes it."""
    return "_drop_object" in DuckDBEngineAdapter.__dict__


def apply() -> None:
    DuckDBEngineAdapter.SUPPORTED_DROP_CASCADE_OBJECT_KINDS = ["SCHEMA"]
