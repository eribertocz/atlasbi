import { api } from '../api/index.ts';
import { Navigation } from './navigation.svelte.ts';

export { Navigation } from './navigation.svelte.ts';
export type { NavigationSource, NavigationStatus, WorkspaceEntry } from './navigation.svelte.ts';

/** The navigation of this tab, from the gateway. */
export const navigation = new Navigation({
  workspaces: async () => (await api.session.me.query()).workspaces,
  reports: (workspaceId) => api.report.list.query({ workspaceId }),
});
