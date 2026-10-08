// Peer declarations of third-party packages that the platform never uses at runtime, removed as
// pnpm reads each manifest (build step 6, Phase C). Otherwise pnpm links them wherever the
// workspace has the package — Vitest, Svelte and SvelteKit next to better-auth, TypeScript next to
// tRPC — and the gateway's production image carries that development tooling.
//
// Review this list whenever better-auth or @trpc/server is upgraded (docs/versions.md): a peer one
// of them starts using at runtime must leave the list, and a new development-only peer joins it.
// `pnpm test:image` fails if the tooling comes back into the image.
const UNUSED_PEERS = {
  // Optional peers for its test helpers and its SvelteKit integration; the platform uses neither.
  'better-auth': ['vitest', 'svelte', '@sveltejs/kit'],
  // A peer for its type-level checks; at runtime the server never loads TypeScript.
  '@trpc/server': ['typescript'],
};

function readPackage(manifest) {
  for (const peer of UNUSED_PEERS[manifest.name] ?? []) {
    delete manifest.peerDependencies?.[peer];
    delete manifest.peerDependenciesMeta?.[peer];
  }
  return manifest;
}

export const hooks = { readPackage };
