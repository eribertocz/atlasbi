<script lang="ts">
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import { SvelteSet } from 'svelte/reactivity';

  import * as Sidebar from '$lib/components/ui/sidebar/index.ts';

  import type { TreeNode } from './tree-node.ts';
  import TreeExplorer from './TreeExplorer.svelte';

  /**
   * The sidebar tree, like a file explorer (docs/08 §11.3): our own recursive component, not a
   * dependency. The first level shows with its icon when the sidebar collapses; deeper levels fold.
   */
  let { nodes, depth = 0 }: { nodes: readonly TreeNode[]; depth?: number } = $props();

  const folded = new SvelteSet<string>();

  function toggle(id: string): void {
    if (folded.has(id)) {
      folded.delete(id);
    } else {
      folded.add(id);
    }
  }
</script>

{#snippet label(node: TreeNode)}
  {#if node.icon}
    <node.icon />
  {/if}
  <span>{node.label}</span>
{/snippet}

{#snippet children(node: TreeNode)}
  {#if node.children !== undefined && node.children.length > 0 && !folded.has(node.id)}
    <TreeExplorer nodes={node.children} depth={depth + 1} />
  {/if}
{/snippet}

{#if depth === 0}
  <Sidebar.Menu>
    {#each nodes as node (node.id)}
      <Sidebar.MenuItem>
        <Sidebar.MenuButton isActive={node.active ?? false} tooltipContent={node.label}>
          {#snippet child({ props })}
            {#if node.href !== undefined}
              <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- hrefs come from resolve() in AppSidebar -->
              <a href={node.href} {...props}>{@render label(node)}</a>
            {:else}
              <span {...props}>{@render label(node)}</span>
            {/if}
          {/snippet}
        </Sidebar.MenuButton>
        {#if node.children !== undefined && node.children.length > 0}
          <Sidebar.MenuAction
            onclick={() => toggle(node.id)}
            aria-expanded={!folded.has(node.id)}
            aria-label={folded.has(node.id) ? `Mostrar ${node.label}` : `Ocultar ${node.label}`}
          >
            <ChevronRightIcon class={folded.has(node.id) ? '' : 'rotate-90'} />
          </Sidebar.MenuAction>
        {/if}
        {@render children(node)}
      </Sidebar.MenuItem>
    {/each}
  </Sidebar.Menu>
{:else}
  <Sidebar.MenuSub>
    {#each nodes as node (node.id)}
      <Sidebar.MenuSubItem>
        <Sidebar.MenuSubButton href={node.href} isActive={node.active ?? false}>
          {@render label(node)}
        </Sidebar.MenuSubButton>
        {@render children(node)}
      </Sidebar.MenuSubItem>
    {/each}
  </Sidebar.MenuSub>
{/if}
