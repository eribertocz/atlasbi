"""Alert probe for project/ducklake_compat.py (run by test/integration/ducklake-compat.test.ts).

Drops a table that a view reads from, in a real DuckLake catalog, through SQLMesh's own DuckDB engine
adapter with cascade=True — exactly what its janitor does — first unpatched, then patched. Prints one
JSON line. When the pinned SQLMesh stops failing unpatched, the upstream fix (PR #6034) has arrived
and the patch must go.
"""

import json
import pathlib
import shutil
import sys
import tempfile

import duckdb
from sqlmesh.core.engine_adapter.duckdb import DuckDBEngineAdapter

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "project"))
import ducklake_compat  # noqa: E402

extension_directory = sys.argv[1]
work = pathlib.Path(tempfile.mkdtemp(prefix="atlasbi-ducklake-drop-")).as_posix()

connection = duckdb.connect(":memory:")
for name, value in [
    ("extension_directory", extension_directory),
    ("autoinstall_known_extensions", "false"),
]:
    connection.execute(f"SET {name} = '{value}'")
connection.execute(f"ATTACH 'ducklake:sqlite:{work}/catalog.sqlite' AS lake (DATA_PATH '{work}/files/')")
connection.execute("USE lake")
adapter = DuckDBEngineAdapter(lambda: connection)


def drop_with_cascade(suffix: str) -> str:
    connection.execute(f"CREATE SCHEMA IF NOT EXISTS lake.physical_{suffix}")
    connection.execute(f"CREATE SCHEMA IF NOT EXISTS lake.virtual_{suffix}")
    connection.execute(f"CREATE TABLE lake.physical_{suffix}.t AS SELECT 1 AS a")
    connection.execute(f"CREATE VIEW lake.virtual_{suffix}.v AS SELECT * FROM lake.physical_{suffix}.t")
    try:
        adapter.drop_table(f"lake.physical_{suffix}.t", cascade=True)
        return "dropped"
    except Exception as error:  # the engine's own message is the evidence
        return str(error).splitlines()[0]


result = {"upstreamFixPresent": ducklake_compat.upstream_fix_present(), "unpatched": drop_with_cascade("a")}
ducklake_compat.apply()
result["patched"] = drop_with_cascade("b")
result["cascadableKinds"] = DuckDBEngineAdapter.SUPPORTED_DROP_CASCADE_OBJECT_KINDS
print(json.dumps(result))
connection.close()
shutil.rmtree(work, ignore_errors=True)
