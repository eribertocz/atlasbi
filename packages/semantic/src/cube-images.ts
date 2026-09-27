/**
 * The Cube images the platform runs, pinned by digest (docs/versions.md). compose.yaml repeats them —
 * a test keeps both in step — and bootstrap uses the Cube image to install the extensions its DuckDB
 * loads inside the container.
 */
export const CUBE_IMAGE =
  'docker.io/cubejs/cube:v1.7.45@sha256:c4dae518806fdedc78b623192ffd187df46d32d212985306a8adf7b1482804a1';

export const CUBE_STORE_IMAGE =
  'docker.io/cubejs/cubestore:v1.7.45@sha256:888a9eb901b1f313836b4d5f1d19ffe035cf0e6595dafa6b6fc03a9daa28523b';

/** Where cube/ is mounted inside the Cube container, and where it looks for the extensions. */
export const CUBE_CONFIG_DIRECTORY = '/cube/conf';
export const CUBE_EXTENSION_DIRECTORY = '/duckdb/extensions';
