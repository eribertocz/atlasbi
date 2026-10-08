<script lang="ts">
  import ChartColumnIcon from '@lucide/svelte/icons/chart-column';

  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { navigation } from '$lib/navigation/index.ts';

  const workspace = $derived(navigation.workspace(page.params.workspace ?? ''));
</script>

{#if workspace !== undefined}
  <h1 class="mb-4 text-xl font-semibold">{workspace.name}</h1>
  {#if workspace.reportsFailed}
    <p class="text-sm text-destructive">No se pudieron cargar los reportes de este workspace.</p>
  {:else if workspace.reports.length === 0}
    <p class="text-sm text-muted-foreground">Este workspace todavía no tiene reportes.</p>
  {:else}
    <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each workspace.reports as report (report.id)}
        <li>
          <a
            class="flex items-center gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
            href={resolve('/workspaces/[workspace]/reports/[report]', {
              workspace: workspace.slug,
              report: report.id,
            })}
          >
            <ChartColumnIcon class="size-5 text-muted-foreground" />
            <span class="font-medium">{report.name}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
{:else if navigation.status === 'ready'}
  <p class="text-sm text-muted-foreground">Ese workspace no existe, o no pertenecés a él.</p>
{:else if navigation.status === 'failed'}
  <p class="text-sm text-destructive">No se pudo cargar la navegación. Probá de nuevo más tarde.</p>
{:else}
  <p class="text-sm text-muted-foreground">Cargando…</p>
{/if}
