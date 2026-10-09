"""What the platform hands the runner — through its environment only (`pnpm ingest`), never a file."""

import os
import re
from dataclasses import dataclass
from typing import Optional

GITHUB_REPOSITORY = re.compile(r"^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$")


class RunnerConfigurationError(Exception):
    """Something the platform sets is missing or wrong; the message names the variable, never a value."""


@dataclass(frozen=True)
class S3Storage:
    endpoint: str
    region: str
    use_ssl: bool
    access_key_id: str
    secret_access_key: str


@dataclass(frozen=True)
class Lakehouse:
    catalog_type: str
    # postgres: the catalog URL without its password — libpq reads PGPASSWORD, so a DuckDB error
    # that repeats the URL has nothing to leak (build step 7, Phase 0).
    catalog_url: Optional[str]
    sqlite_path: Optional[str]
    data_path: str
    extension_directory: str
    s3: Optional[S3Storage]


@dataclass(frozen=True)
class GitHubSettings:
    repositories: tuple
    api_url: str
    token: str


@dataclass(frozen=True)
class RunnerSettings:
    data_directory: str
    lakehouse: Lakehouse
    github: Optional[GitHubSettings]


def _require(name: str) -> str:
    value = os.environ.get(name, "")
    if value == "":
        raise RunnerConfigurationError(f"{name} is not set")
    return value


def read_settings(source: str, landing_only: bool = False) -> RunnerSettings:
    """`landing_only` reads no source settings: publishing the landing never asks the source."""
    if os.environ.get("ATLASBI_INGESTION_MODE") != "platform":
        raise RunnerConfigurationError(
            "Run the ingestion through `pnpm ingest <source>`: it checks the lakehouse and hands over the secrets"
        )
    catalog_type = _require("ATLASBI_LAKEHOUSE_CATALOG_TYPE")
    if catalog_type not in ("postgres", "sqlite"):
        raise RunnerConfigurationError("ATLASBI_LAKEHOUSE_CATALOG_TYPE must be postgres or sqlite")
    s3 = None
    if catalog_type == "postgres":
        catalog_url = _require("ATLASBI_LAKEHOUSE_CATALOG_URL")
        if re.search(r"//[^/@]*:[^/@]*@", catalog_url):
            raise RunnerConfigurationError(
                "ATLASBI_LAKEHOUSE_CATALOG_URL must not carry a password: it travels in PGPASSWORD"
            )
        s3 = S3Storage(
            endpoint=_require("ATLASBI_LAKEHOUSE_S3_ENDPOINT"),
            region=_require("ATLASBI_LAKEHOUSE_S3_REGION"),
            use_ssl=_require("ATLASBI_LAKEHOUSE_S3_USE_SSL") == "true",
            access_key_id=_require("ATLASBI_LAKEHOUSE_S3_ACCESS_KEY_ID"),
            secret_access_key=_require("ATLASBI_LAKEHOUSE_S3_SECRET_ACCESS_KEY"),
        )
    lakehouse = Lakehouse(
        catalog_type=catalog_type,
        catalog_url=catalog_url if catalog_type == "postgres" else None,
        sqlite_path=_require("ATLASBI_LAKEHOUSE_SQLITE_PATH") if catalog_type == "sqlite" else None,
        data_path=_require("ATLASBI_LAKEHOUSE_DATA_PATH"),
        extension_directory=_require("ATLASBI_DUCKDB_EXTENSION_DIRECTORY"),
        s3=s3,
    )
    github = None
    if source == "github" and not landing_only:
        repositories = tuple(
            item.strip() for item in os.environ.get("ATLASBI_GITHUB_REPOSITORIES", "").split(",") if item.strip()
        )
        if not repositories:
            raise RunnerConfigurationError("ATLASBI_GITHUB_REPOSITORIES lists no repository (owner/name, comma-separated)")
        for repository in repositories:
            if not GITHUB_REPOSITORY.match(repository):
                raise RunnerConfigurationError("ATLASBI_GITHUB_REPOSITORIES must list owner/name entries")
        github = GitHubSettings(
            repositories=repositories,
            api_url=_require("ATLASBI_GITHUB_API_URL").rstrip("/"),
            token=_require("ATLASBI_GITHUB_TOKEN"),
        )
    return RunnerSettings(
        data_directory=_require("ATLASBI_INGESTION_DATA_PATH"), lakehouse=lakehouse, github=github
    )


def isolate_home(data_directory: str) -> None:
    """dlt writes an anonymous id into the user's home on every run, even with telemetry off, and
    only follows XDG_DATA_HOME while ~/.dlt does not exist (build step 7, Phase 0). The runner gives
    it a home of its own inside the ingestion folder — before dlt is imported — so the user's home
    is never touched, whether ~/.dlt exists or not."""
    home = os.path.join(data_directory, "home")
    os.makedirs(home, exist_ok=True)
    for name in ("HOME", "USERPROFILE"):
        os.environ[name] = home
    os.environ["XDG_DATA_HOME"] = os.path.join(home, "xdg")
