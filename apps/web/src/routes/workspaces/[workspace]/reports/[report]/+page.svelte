<script lang="ts">
  import type { ReportDocument } from '@atlasbi/contracts';
  import { TRPCClientError } from '@trpc/client';

  import { page } from '$app/state';
  import { api } from '$lib/api/index.ts';
  import { navigation } from '$lib/navigation/index.ts';
  import ReportView from '$lib/report/ReportView.svelte';

  type Load =
    | { status: 'loading' }
    | { status: 'ready'; report: ReportDocument; titles: ReadonlyMap<string, string> }
    | { status: 'not-found' }
    | { status: 'failed' };

  const workspace = $derived(navigation.workspace(page.params.workspace ?? ''));
  const reportId = $derived(page.params.report ?? '');
  let load = $state.raw<Load>({ status: 'loading' });

  // The report, and the titles of the model's members for its labels — the titles are optional:
  // without them a visual shows member names.
  $effect(() => {
    const workspaceId = workspace?.workspaceId;
    if (workspaceId === undefined) {
      return;
    }
    const controller = new AbortController();
    const signal = controller.signal;
    load = { status: 'loading' };
    Promise.all([
      api.report.get.query({ workspaceId, reportId }, { signal }),
      api.semantic.meta.query({ workspaceId }, { signal }).catch(() => undefined),
    ])
      .then(([report, model]) => {
        const members = model === undefined ? [] : [...model.measures, ...model.dimensions];
        load = {
          status: 'ready',
          report,
          titles: new Map(members.map((member) => [member.name, member.title])),
        };
      })
      .catch((error: unknown) => {
        if (signal.aborted) {
          return;
        }
        const code = error instanceof TRPCClientError ? (error.data as { code?: string }).code : '';
        load = { status: code === 'NOT_FOUND' || code === 'BAD_REQUEST' ? 'not-found' : 'failed' };
      });
    return () => controller.abort();
  });
</script>

{#if workspace === undefined && navigation.status === 'ready'}
  <p class="text-sm text-muted-foreground">Ese workspace no existe, o no pertenecés a él.</p>
{:else if load.status === 'ready'}
  {#key load.report.id}
    <ReportView report={load.report} titles={load.titles} />
  {/key}
{:else if load.status === 'not-found'}
  <p class="text-sm text-muted-foreground">Ese reporte no existe en este workspace.</p>
{:else if load.status === 'failed'}
  <p class="text-sm text-destructive">No se pudo abrir el reporte. Probá de nuevo más tarde.</p>
{:else}
  <p class="text-sm text-muted-foreground">Cargando…</p>
{/if}
