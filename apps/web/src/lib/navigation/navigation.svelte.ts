import type { ReportSummary, WorkspaceRole } from '@atlasbi/contracts';

/** A workspace someone belongs to, with the reports they can open in it. */
export interface WorkspaceEntry {
  workspaceId: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
  reports: readonly ReportSummary[];
  /** The reports could not be listed; the workspace still shows. */
  reportsFailed: boolean;
}

/** Where navigation reads from: the gateway, or a fake in tests. */
export interface NavigationSource {
  workspaces(): Promise<readonly Omit<WorkspaceEntry, 'reports' | 'reportsFailed'>[]>;
  reports(workspaceId: string): Promise<readonly ReportSummary[]>;
}

export type NavigationStatus = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * What the sidebar shows (docs/08 §11.3, §12): the person's workspaces and, in each, the reports
 * they can open. Loaded once per sign-in; a workspace whose reports fail to load still shows.
 */
export class Navigation {
  status = $state<NavigationStatus>('idle');
  workspaces = $state.raw<readonly WorkspaceEntry[]>([]);
  readonly #source: NavigationSource;

  constructor(source: NavigationSource) {
    this.#source = source;
  }

  async load(): Promise<void> {
    this.status = 'loading';
    try {
      const workspaces = await this.#source.workspaces();
      const lists = await Promise.allSettled(
        workspaces.map((workspace) => this.#source.reports(workspace.workspaceId)),
      );
      this.workspaces = workspaces.map((workspace, index) => {
        const list = lists[index];
        return list?.status === 'fulfilled'
          ? { ...workspace, reports: list.value, reportsFailed: false }
          : { ...workspace, reports: [], reportsFailed: true };
      });
      this.status = 'ready';
    } catch {
      this.status = 'failed';
    }
  }

  workspace(slug: string): WorkspaceEntry | undefined {
    return this.workspaces.find((workspace) => workspace.slug === slug);
  }

  /** On sign-out: nothing of the previous person stays. */
  reset(): void {
    this.workspaces = [];
    this.status = 'idle';
  }
}
