<script lang="ts">
  import '../app.css';

  import type { Snippet } from 'svelte';

  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import * as Sidebar from '$lib/components/ui/sidebar/index.ts';
  import AppSidebar from '$lib/navigation/AppSidebar.svelte';
  import { navigation } from '$lib/navigation/index.ts';
  import { PRODUCT_DISPLAY_NAME } from '$lib/product.ts';
  import { session } from '$lib/session/index.ts';

  let { children }: { children: Snippet } = $props();

  // Whether the sidebar is open: a convenience of this browser, nothing more.
  const SIDEBAR_OPEN_KEY = 'sidebar-open';
  let sidebarOpen = $state(readSidebarOpen());

  function readSidebarOpen(): boolean {
    try {
      return localStorage.getItem(SIDEBAR_OPEN_KEY) !== 'false';
    } catch {
      return true;
    }
  }

  function rememberSidebarOpen(open: boolean): void {
    try {
      localStorage.setItem(SIDEBAR_OPEN_KEY, String(open));
    } catch {
      // Storage may be unavailable (private mode); the sidebar still works.
    }
  }

  // On load the session cookie, if any, gives a token; without one, everything leads to sign-in.
  $effect(() => {
    if (session.status === 'unknown') {
      void session.restore();
    }
  });
  $effect(() => {
    if (session.status === 'signed-out' && page.route.id !== '/login') {
      void goto(resolve('/login'));
    }
  });
  // What the sidebar shows belongs to whoever is signed in: loaded on sign-in, gone on sign-out.
  $effect(() => {
    if (session.status === 'signed-in' && navigation.status === 'idle') {
      void navigation.load();
    } else if (session.status === 'signed-out' && navigation.status !== 'idle') {
      navigation.reset();
    }
  });
</script>

<svelte:head>
  <title>{PRODUCT_DISPLAY_NAME}</title>
</svelte:head>

{#if session.status === 'unknown'}
  <p class="p-8 text-muted-foreground">Cargando…</p>
{:else if session.status === 'signed-in' && page.route.id !== '/login'}
  <Sidebar.Provider bind:open={sidebarOpen} onOpenChange={rememberSidebarOpen}>
    <AppSidebar
      workspaces={navigation.workspaces}
      failed={navigation.status === 'failed'}
      onsignout={() => void session.signOut()}
    />
    <Sidebar.Inset>
      <header class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Sidebar.Trigger />
      </header>
      <main class="flex-1 p-4 md:p-6">
        {@render children()}
      </main>
    </Sidebar.Inset>
  </Sidebar.Provider>
{:else}
  {@render children()}
{/if}
