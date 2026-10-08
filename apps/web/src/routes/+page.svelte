<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { navigation } from '$lib/navigation/index.ts';

  // Home is the first workspace's reports (docs/20 §3, Viewer mode): there is nothing else yet.
  $effect(() => {
    const [first] = navigation.status === 'ready' ? navigation.workspaces : [];
    if (first !== undefined) {
      void goto(resolve('/workspaces/[workspace]', { workspace: first.slug }), {
        replaceState: true,
      });
    }
  });
</script>

{#if navigation.status === 'failed'}
  <p class="text-sm text-destructive">No se pudo cargar la navegación. Probá de nuevo más tarde.</p>
{:else if navigation.status === 'ready' && navigation.workspaces.length === 0}
  <p class="text-sm text-muted-foreground">Todavía no pertenecés a ningún workspace.</p>
{:else}
  <p class="text-sm text-muted-foreground">Cargando…</p>
{/if}
