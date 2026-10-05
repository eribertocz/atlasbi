/**
 * The data contracts this layer reads (docs/21 §2.4), pinned to a major version: the Cube model
 * names their tables, and its tests run against a mart built from the contract itself — so a
 * member that reads a column the contract does not promise fails here, not in production.
 */
export const CONSUMED_DATA_CONTRACTS = [{ id: 'mart.sales_orders', major: 1 }] as const;
