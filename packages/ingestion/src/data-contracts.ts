/**
 * The data contracts this layer publishes (docs/21 §2.4), pinned to a major version: the landing
 * views the runner writes. Its integration tests check them with data; what lies behind them — the
 * tool's own tables — is this package's business.
 */
export const PRODUCED_DATA_CONTRACTS = [{ id: 'landing.github_repo_events', major: 1 }] as const;
