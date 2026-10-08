<script lang="ts">
  import type { ReportDocument } from '@atlasbi/contracts';

  import { api } from '$lib/api/index.ts';
  import { Button } from '$lib/components/ui/button/index.ts';
  import { PRODUCT_DISPLAY_NAME } from '$lib/product.ts';

  import { InteractionState } from './interaction-state.svelte.ts';
  import { QueryCoordinator } from './query-coordinator.ts';
  import ReportPageView from './ReportPageView.svelte';

  let {
    report,
    titles,
  }: {
    report: ReportDocument;
    titles: ReadonlyMap<string, string>;
  } = $props();

  // One per report opened (the page keys this component by report): selections never carry over
  // from one report to another, and every visual queries through the same coordinator.
  const interaction = new InteractionState();
  const coordinator = new QueryCoordinator((query, signal) =>
    api.semantic.query.query({ workspaceId: report.workspaceId, query }, { signal }),
  );

  let pageIndex = $state(0);
  const shown = $derived(report.pages[pageIndex] ?? report.pages[0]);
</script>

<svelte:head>
  <title>{report.name} · {PRODUCT_DISPLAY_NAME}</title>
</svelte:head>

<header class="mb-4 flex flex-wrap items-center justify-between gap-2">
  <h1 class="text-xl font-semibold">{report.name}</h1>
  {#if report.pages.length > 1}
    <nav class="flex gap-1" aria-label="Páginas del reporte">
      {#each report.pages as reportPage, index (reportPage.id)}
        <Button
          variant={index === pageIndex ? 'secondary' : 'ghost'}
          size="sm"
          aria-current={index === pageIndex ? 'page' : undefined}
          onclick={() => (pageIndex = index)}>{reportPage.name}</Button
        >
      {/each}
    </nav>
  {/if}
</header>

{#if shown === undefined}
  <p class="text-sm text-muted-foreground">Este reporte no tiene páginas.</p>
{:else}
  <ReportPageView page={shown} {interaction} {coordinator} {titles} />
{/if}
