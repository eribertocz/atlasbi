import { type DataContract, getDataContract } from '@atlasbi/contracts';
import type { ContractRowValue } from '@atlasbi/warehouse/testing';

/** GitHub events as the landing contract promises them: one per event, completed loads only. */
export const GITHUB_LANDING_ROWS: readonly Record<string, ContractRowValue>[] = [
  ['acme/widgets#1', 'PushEvent', 'acme/widgets', 'ana', '2026-10-01T09:00:00Z', 'load-1'],
  ['acme/widgets#2', 'IssuesEvent', 'acme/widgets', 'bruno', '2026-10-01T10:30:00Z', 'load-1'],
  ['acme/widgets#3', 'PushEvent', 'acme/widgets', 'ana', '2026-10-02T08:15:00Z', 'load-2'],
  ['acme/gadgets#1', 'WatchEvent', 'acme/gadgets', null, '2026-10-01T12:00:00Z', 'load-3'],
  ['acme/gadgets#2', 'PushEvent', 'acme/gadgets', 'carla', '2026-10-03T23:59:59Z', 'load-3'],
].map(([eventId, eventType, repository, actor, createdAt, loadId]) => ({
  /* eslint-disable @typescript-eslint/naming-convention -- the contract's column names. */
  event_id: eventId ?? null,
  event_type: eventType ?? null,
  repository: repository ?? null,
  actor: actor ?? null,
  created_at: createdAt ?? null,
  _load_id: loadId ?? null,
  _loaded_at: '2026-10-04T00:00:00Z',
  /* eslint-enable @typescript-eslint/naming-convention */
}));

export function githubLandingContract(): DataContract {
  return getDataContract('landing.github_repo_events', 1);
}
