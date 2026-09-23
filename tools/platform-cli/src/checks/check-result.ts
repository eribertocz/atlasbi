/** `warn` never blocks: it reports something `pnpm dev` resolves on its own or later steps need. */
export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  remedy?: string;
}
