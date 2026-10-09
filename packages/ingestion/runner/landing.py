"""Publishes the landing contract (docs/21 §2.4): views over what the tool wrote, with the platform's
own technical columns — rows of completed loads only, each record once (build step 7, Phase 0)."""

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class LandingTable:
    schema: str
    name: str

    def sql(self) -> str:
        return f'"{self.schema}"."{self.name}"'


@dataclass(frozen=True)
class Published:
    table: LandingTable
    rows_added: int
    rows_total: int


def count_rows(client, table: LandingTable) -> Optional[int]:
    """What the landing holds now; None before it was ever published."""
    exists = client.execute_sql(
        "select count(*) from duckdb_views() where database_name = current_database() "
        "and schema_name = ? and view_name = ?",
        table.schema,
        table.name,
    )
    if not exists or exists[0][0] == 0:
        return None
    return client.execute_sql(f"select count(*) from {table.sql()}")[0][0]


def tables_of(client, schema: str) -> list:
    rows = client.execute_sql(
        "select table_name from duckdb_tables() where database_name = current_database() "
        "and schema_name = ? order by table_name",
        schema,
    )
    return [row[0] for row in rows or []]


def publish_view(client, table: LandingTable, select_sql: str) -> None:
    # Created inside the lake with catalog-relative names: any reader, under any attach alias,
    # resolves them (measured in Phase 0).
    client.execute_sql(f'create schema if not exists "{table.schema}"')
    client.execute_sql(f"create or replace view {table.sql()} as {select_sql}")
