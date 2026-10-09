/**
 * The data contracts this layer keeps (docs/21 §2.4): what it publishes, pinned to a major
 * version, and what it reads. Its tests check both against the published tables; the SQLMesh
 * project behind them is this package's business.
 */
export const PRODUCED_DATA_CONTRACTS = [
  { id: 'mart.sales_orders', major: 1 },
  { id: 'mart.github_repo_events', major: 1 },
] as const;

export const CONSUMED_DATA_CONTRACTS = [
  { id: 'source.development_sales_orders', major: 1 },
  { id: 'landing.github_repo_events', major: 1 },
] as const;
