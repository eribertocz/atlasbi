"""dlt's DuckLake destination, pointed at the platform's lakehouse — the four settings dlt does not
choose by itself (build step 7, Phase 0)."""

from .settings import Lakehouse

# The attach alias of dlt's own connections; nothing else depends on it (views bind relative to
# their lake, measured in Phase 0).
LAKE = "lake"

# Offline: the extensions `pnpm bootstrap` installed, never a download. dlt LOADs its `extensions`
# before it applies `extension_directory`, so autoloading from `global_config` is the safe path.
OFFLINE = {
    "autoinstall_known_extensions": False,
    "autoload_known_extensions": True,
}


def ducklake_destination(lakehouse: Lakehouse):
    from dlt.common.configuration.specs import AwsCredentials
    from dlt.common.storages.configuration import FilesystemConfiguration
    from dlt.destinations import ducklake
    from dlt.destinations.impl.ducklake.configuration import DuckLakeCredentials

    if lakehouse.catalog_type == "postgres":
        s3 = lakehouse.s3
        storage = FilesystemConfiguration(
            bucket_url=lakehouse.data_path,
            credentials=AwsCredentials(
                aws_access_key_id=s3.access_key_id,
                aws_secret_access_key=s3.secret_access_key,
                endpoint_url=f"{'https' if s3.use_ssl else 'http'}://{s3.endpoint}",
                region_name=s3.region,
            ),
        )
        credentials = DuckLakeCredentials(
            ducklake_name=LAKE,
            # The platform's lake keeps its metadata in `public`; dlt's default (`ducklake`) would
            # create a second, empty lake in the same database without a word.
            metadata_schema="public",
            catalog=lakehouse.catalog_url,
            storage=storage,
        )
    else:
        credentials = DuckLakeCredentials(
            ducklake_name=LAKE,
            catalog=f"sqlite:///{lakehouse.sqlite_path}",
            storage=lakehouse.data_path,
        )
    credentials.global_config = {"extension_directory": lakehouse.extension_directory, **OFFLINE}
    return ducklake(credentials=credentials)
