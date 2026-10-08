<script lang="ts">
  import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import LogOutIcon from '@lucide/svelte/icons/log-out';

  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import * as Sidebar from '$lib/components/ui/sidebar/index.ts';
  import { PRODUCT_DISPLAY_NAME } from '$lib/product.ts';

  import type { WorkspaceEntry } from './navigation.svelte.ts';
  import type { TreeNode } from './tree-node.ts';
  import TreeExplorer from './TreeExplorer.svelte';

  let {
    workspaces,
    failed,
    onsignout,
  }: {
    workspaces: readonly WorkspaceEntry[];
    failed: boolean;
    onsignout: () => void;
  } = $props();

  // The only navigation of the app (docs/08 §12): workspaces, and the reports of each. Modules
  // that do not exist yet (Explore, Data, Monitor, Admin — docs/20 §2) are not shown.
  const tree = $derived<TreeNode[]>(
    workspaces.map((workspace) => ({
      id: workspace.workspaceId,
      label: workspace.name,
      icon: FolderIcon,
      href: resolve('/workspaces/[workspace]', { workspace: workspace.slug }),
      active: page.params.workspace === workspace.slug && page.params.report === undefined,
      children: workspace.reports.map((report) => ({
        id: report.id,
        label: report.name,
        icon: ChartColumnIcon,
        href: resolve('/workspaces/[workspace]/reports/[report]', {
          workspace: workspace.slug,
          report: report.id,
        }),
        active: page.params.report === report.id,
      })),
    })),
  );
</script>

<Sidebar.Root collapsible="icon">
  <Sidebar.Header>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton size="lg" tooltipContent={PRODUCT_DISPLAY_NAME}>
          {#snippet child({ props })}
            <a href={resolve('/')} {...props}>
              <span
                class="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary font-semibold text-sidebar-primary-foreground"
                aria-hidden="true">{PRODUCT_DISPLAY_NAME.charAt(0)}</span
              >
              <span class="font-semibold">{PRODUCT_DISPLAY_NAME}</span>
            </a>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Header>
  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.GroupLabel>Reportes</Sidebar.GroupLabel>
      <Sidebar.GroupContent>
        {#if failed}
          <p class="px-2 text-sm text-destructive">No se pudo cargar la navegación.</p>
        {:else}
          <TreeExplorer nodes={tree} />
        {/if}
      </Sidebar.GroupContent>
    </Sidebar.Group>
  </Sidebar.Content>
  <Sidebar.Footer>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton onclick={onsignout} tooltipContent="Salir">
          <LogOutIcon />
          <span>Salir</span>
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Footer>
  <Sidebar.Rail />
</Sidebar.Root>
