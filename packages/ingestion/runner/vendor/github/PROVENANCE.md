# GitHub verified source — copied, not installed

dlt's verified sources are not a package: `dlt init` copies their code into a project. This folder
is that copy, kept as the platform's own code (docs/03 §8, docs/13 step 1).

- **Origin:** <https://github.com/dlt-hub/verified-sources>, Apache-2.0, `sources/github`.
- **Copied at:** commit `3957506893a7da821dbcc6acd51c7ca4475d1f53` (2026-07-03) of that
  repository. The `sources/github` folder last changed in
  `35717f142452948bb821b3f3adba3fd829370fad` (2024-10-01).
- **Local changes:** none. The runner points `helpers.REST_API_BASE_URL` at
  `ATLASBI_GITHUB_API_URL` (GitHub Enterprise, the fake API of the tests) instead of editing
  these files, and only `github_repo_events` is used: it is the source's one incremental resource.
- **Review:** check that repository for a newer version of this source whenever dlt is upgraded,
  and at least once per milestone (docs/versions.md). Update by copying the folder again at a
  pinned commit and recording it here.
