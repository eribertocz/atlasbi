export const LAKEHOUSE_ERROR_CODES = [
  'extension_missing',
  'catalog_unreachable',
  /** The object storage refused the credentials, has no such bucket, or does not answer. Since 1.1. */
  'storage_unreachable',
  'catalog_format_mismatch',
  'data_path_mismatch',
  'query_failed',
  'read_only_violation',
  'write_conflict',
  'catalog_busy',
  'engine_closed',
] as const;

export type LakehouseErrorCode = (typeof LAKEHOUSE_ERROR_CODES)[number];

export interface LakehouseErrorOptions {
  retryable?: boolean;
  /** What the operator should do about it, e.g. which command to run. */
  remedy?: string;
}

/**
 * The only error the lakehouse ports reject with. Engine exceptions never cross the adapter
 * (docs/21 §3.2), and messages never carry credentials.
 */
export class LakehouseError extends Error {
  readonly code: LakehouseErrorCode;
  /** True when trying again later may succeed without changing anything. */
  readonly retryable: boolean;
  readonly remedy: string | undefined;

  constructor(code: LakehouseErrorCode, message: string, options: LakehouseErrorOptions = {}) {
    super(message);
    this.name = 'LakehouseError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.remedy = options.remedy;
  }
}
