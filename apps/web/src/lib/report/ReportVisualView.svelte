<script lang="ts">
  import type { ReportVisual, SemanticQuery, SemanticResult } from '@atlasbi/contracts';

  import { Skeleton } from '$lib/components/ui/skeleton/index.ts';
  import { toChartData } from '$lib/visualization/chart-data.ts';
  import EChartsChart from '$lib/visualization/echarts/EChartsChart.svelte';
  import { formatNumber } from '$lib/visualization/format.ts';

  import type { InteractionState } from './interaction-state.svelte.ts';
  import type { QueryCoordinator } from './query-coordinator.ts';
  import { toSemanticQuery } from './visual-query.ts';

  let {
    visual,
    interaction,
    coordinator,
    titles,
  }: {
    visual: ReportVisual;
    interaction: InteractionState;
    coordinator: QueryCoordinator;
    /** Titles of the semantic model's members, by name. */
    titles: ReadonlyMap<string, string>;
  } = $props();

  type Load =
    { status: 'loading' } | { status: 'ready'; result: SemanticResult } | { status: 'failed' };

  let load = $state.raw<Load>({ status: 'loading' });

  const spec = $derived(visual.spec);
  const category = $derived(spec.encoding?.category);
  // A category grouped by time is read along time; it selects nothing in this first cut.
  const selectable = $derived(category !== undefined && spec.encoding?.granularity === undefined);
  // As text: the visual asks again only when its question changes — not when its own selection
  // filters the others.
  const question = $derived(
    JSON.stringify(toSemanticQuery(spec, interaction.filtersFor(visual.id))),
  );
  const selected = $derived(
    selectable && category !== undefined ? interaction.selectionOf(visual.id, category) : undefined,
  );
  const title = $derived.by(() => {
    const measures = spec.measures.map((member) => titles.get(member) ?? member).join(' · ');
    return category === undefined
      ? measures
      : `${measures} por ${titles.get(category) ?? category}`;
  });

  $effect(() => {
    const query = JSON.parse(question) as SemanticQuery;
    let current = true;
    coordinator
      .query(visual.id, query)
      .then((outcome) => {
        if (current && outcome.status === 'done') {
          load = { status: 'ready', result: outcome.result };
        }
      })
      .catch(() => {
        if (current) {
          load = { status: 'failed' };
        }
      });
    return () => {
      current = false;
      coordinator.cancel(visual.id);
    };
  });

  function select(value: string): void {
    if (selectable && category !== undefined) {
      interaction.toggleSelection(visual.id, category, value);
    }
  }
</script>

<section class="flex h-full min-h-0 flex-col rounded-lg border bg-card p-4 text-card-foreground">
  <h2 class="truncate text-sm font-medium text-muted-foreground" {title}>{title}</h2>
  <div class="relative min-h-0 flex-1">
    {#if load.status === 'loading'}
      <Skeleton class="mt-3 h-[calc(100%-0.75rem)] w-full" />
    {:else if load.status === 'failed'}
      <p class="mt-3 text-sm text-destructive">No se pudieron cargar los datos.</p>
    {:else if load.result.rowCount === 0}
      <p class="mt-3 text-sm text-muted-foreground">Sin datos para esta selección.</p>
    {:else if spec.kind === 'kpi'}
      {@const value = load.result.rows[0]?.[load.result.columns.length - 1]}
      <p class="mt-2 text-3xl font-semibold tabular-nums">
        {typeof value === 'string' ? formatNumber(Number(value)) : '—'}
      </p>
    {:else}
      <EChartsChart
        kind={spec.kind}
        data={toChartData(load.result, { titles })}
        {selected}
        label={title}
        onselect={selectable ? select : undefined}
      />
    {/if}
  </div>
</section>
