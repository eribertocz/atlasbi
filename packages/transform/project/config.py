"""SQLMesh configuration of the lakehouse project (build step 2, docs/02).

Everything comes from environment variables that `pnpm transform` sets for this process only:
absolute paths already resolved and secrets already read through the platform's SecretProvider.
Running `sqlmesh` any other way is unsupported — among other things, the platform verifies the
lakehouse is provisioned before SQLMesh attaches it, because SQLMesh's ATTACH would otherwise
create an empty lakehouse silently (Phase 0 of build step 2).
"""

import os
import re
from urllib.parse import unquote, urlparse

from sqlmesh.core.config import (
    Config,
    DuckDBConnectionConfig,
    GatewayConfig,
    LinterConfig,
    ModelDefaultsConfig,
    PostgresConnectionConfig,
)
from sqlmesh.core.config.connection import DuckDBAttachOptions
from sqlmesh.utils.errors import ConfigError

import ducklake_compat

LAKE_ALIAS = "lake"
UNSUPPORTED = "Run SQLMesh through `pnpm transform` — it sets {name} for this process (packages/transform)."


def required(name: str) -> str:
    value = os.environ.get(name, "")
    if value == "":
        raise ConfigError(UNSUPPORTED.format(name=name))
    return value


def offline_duckdb_settings() -> dict[str, str]:
    # Never SQLMesh's `extensions` option: it runs INSTALL before these settings apply, which would
    # download into the user's global ~/.duckdb. The ATTACH below loads from the project directory.
    return {
        "extension_directory": required("ATLASBI_DUCKDB_EXTENSION_DIRECTORY"),
        "autoinstall_known_extensions": "false",
        "TimeZone": "UTC",
    }


def postgres_parts(url: str, name: str) -> dict[str, object]:
    parsed = urlparse(url)
    if parsed.scheme not in ("postgres", "postgresql") or parsed.query:
        raise ConfigError(f"{name} must be a plain postgres://user:password@host:port/database URL.")
    return {
        "host": parsed.hostname,
        "port": parsed.port or 5432,
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "database": parsed.path.lstrip("/"),
    }


def lakehouse_connection() -> DuckDBConnectionConfig:
    catalog_type = required("ATLASBI_LAKEHOUSE_CATALOG_TYPE")
    data_path = required("ATLASBI_LAKEHOUSE_DATA_PATH")
    secrets: list[dict[str, str]] = []
    if catalog_type == "postgres":
        parts = postgres_parts(required("ATLASBI_LAKEHOUSE_CATALOG_URL"), "ATLASBI_LAKEHOUSE_CATALOG_URL")
        # An unnamed postgres secret applies to every postgres attach: the password never travels
        # in the ATTACH string, which DuckDB would echo in its errors (docs/01 §6.7).
        secrets = [
            {
                "type": "postgres",
                "host": str(parts["host"]),
                "port": str(parts["port"]),
                "user": str(parts["user"]),
                "password": str(parts["password"]),
            }
        ]
        path = f"postgres:dbname={parts['database']}"
    elif catalog_type == "sqlite":
        path = f"sqlite:{required('ATLASBI_LAKEHOUSE_SQLITE_PATH')}"
    else:
        raise ConfigError(f"Unsupported lakehouse catalog type {catalog_type!r} (postgres | sqlite).")
    if data_path.startswith("s3://"):
        # The writer key, scoped to the lakehouse's data path only; path-style URLs because a
        # self-hosted object storage has no wildcard DNS for virtual-hosted buckets (docs/01 §6.7).
        secrets.append(
            {
                "type": "s3",
                "key_id": required("ATLASBI_LAKEHOUSE_S3_ACCESS_KEY_ID"),
                "secret": required("ATLASBI_LAKEHOUSE_S3_SECRET_ACCESS_KEY"),
                "endpoint": required("ATLASBI_LAKEHOUSE_S3_ENDPOINT"),
                "region": required("ATLASBI_LAKEHOUSE_S3_REGION"),
                "use_ssl": required("ATLASBI_LAKEHOUSE_S3_USE_SSL"),
                "url_style": "path",
                "scope": data_path,
            }
        )
    return DuckDBConnectionConfig(
        catalogs={LAKE_ALIAS: DuckDBAttachOptions(type="ducklake", path=path, data_path=data_path)},
        connector_config=offline_duckdb_settings(),
        secrets=secrets,
    )


def unit_test_connection() -> DuckDBConnectionConfig:
    """In-memory DuckDB for SQLMesh unit tests: no lakehouse, no secrets, still offline."""
    return DuckDBConnectionConfig(connector_config=offline_duckdb_settings())


def state_schema() -> str:
    # One state per lakehouse, named after the lakehouse identity (docs/02 §6.3).
    schema = required("ATLASBI_TRANSFORM_STATE_SCHEMA")
    if not re.fullmatch(r"sqlmesh_[0-9a-f]{32}", schema):
        raise ConfigError(f"ATLASBI_TRANSFORM_STATE_SCHEMA is not a lakehouse state schema: {schema!r}.")
    return schema


def gateway() -> GatewayConfig:
    if os.environ.get("ATLASBI_TRANSFORM_MODE") == "unit-tests":
        return GatewayConfig(
            connection=unit_test_connection(),
            state_connection=unit_test_connection(),
            test_connection=unit_test_connection(),
        )
    return GatewayConfig(
        connection=lakehouse_connection(),
        state_connection=PostgresConnectionConfig(
            **postgres_parts(required("ATLASBI_TRANSFORM_STATE_URL"), "ATLASBI_TRANSFORM_STATE_URL")
        ),
        test_connection=unit_test_connection(),
        state_schema=state_schema(),
    )


ducklake_compat.apply()

config = Config(
    gateways={"local": gateway()},
    default_gateway="local",
    model_defaults=ModelDefaultsConfig(dialect="duckdb"),
    linter=LinterConfig(
        enabled=True,
        rules={
            "noselectstar",
            "ambiguousorinvalidcolumn",
            "invalidselectstarexpansion",
            "noplatformmanagedstatements",
        },
    ),
)
