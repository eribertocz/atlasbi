<script lang="ts">
  import { REPORT_GRID_COLUMNS, type ReportPage } from '@atlasbi/contracts';
  import XIcon from '@lucide/svelte/icons/x';

  import { Button } from '$lib/components/ui/button/index.ts';

  import type { InteractionState } from './interaction-state.svelte.ts';
  import type { QueryCoordinator } from './query-coordinator.ts';
  import ReportVisualView from './ReportVisualView.svelte';

  let {
    page,
    interaction,
    coordinator,
    titles,
  }: {
    page: ReportPage;
    interaction: InteractionState;
    coordinator: QueryCoordinator;
    titles: ReadonlyMap<string, string>;
  } = $props();

  /** One grid row, in pixels: a visual's height is counted in these. */
  const ROW_HEIGHT = 88;
</script>

{#if interaction.activeFilters.length > 0}
  <div class="mb-4 flex flex-wrap items-center gap-2" aria-live="polite">
    <span class="text-sm text-muted-foreground">Filtrado por</span>
    {#each interaction.activeFilters as filter (filter.member)}
      <Button
        variant="secondary"
        size="sm"
        onclick={() => interaction.clearFilter(filter.member)}
        aria-label={`Quitar el filtro ${titles.get(filter.member) ?? filter.member}`}
      >
        {titles.get(filter.member) ?? filter.member}: {filter.values.join(', ')}
        <XIcon />
      </Button>
    {/each}
  </div>
{/if}

<!-- The grid of the page; on a narrow screen, one visual per row in reading order. -->
<div class="report-grid" style:--columns={REPORT_GRID_COLUMNS} style:--row-height="{ROW_HEIGHT}px">
  {#each page.visuals as visual (visual.id)}
    <div
      class="report-cell"
      style:--x={visual.position.x + 1}
      style:--y={visual.position.y + 1}
      style:--width={visual.position.width}
      style:--height={visual.position.height}
    >
      <ReportVisualView {visual} {interaction} {coordinator} {titles} />
    </div>
  {/each}
</div>

<style>
  .report-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: minmax(0, 1fr);
    grid-auto-rows: var(--row-height);
  }

  .report-cell {
    grid-row: span var(--height);
  }

  @media (min-width: 48rem) {
    .report-grid {
      grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
    }

    .report-cell {
      grid-column: var(--x) / span var(--width);
      grid-row: var(--y) / span var(--height);
    }
  }
</style>
