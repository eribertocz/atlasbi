import adapter from '@sveltejs/adapter-static';

/**
 * A single-page app (build step 6, decision H1): the identity token lives only in the browser's
 * memory, so there is nothing to render on a server. If server rendering is ever needed, this
 * decision is revisited first (docs/08).
 */
export default {
  compilerOptions: { runes: true },
  kit: {
    adapter: adapter({ fallback: 'index.html' }),
    // The page's own policy, with the hash of SvelteKit's inline start-up script: no inline script
    // runs but that one. Styles allow inline: Svelte and the copied components set them. The
    // proxy adds what a page cannot declare for itself (frame-ancestors, infra/images/Caddyfile).
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'data:'],
        'font-src': ['self'],
        'connect-src': ['self'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
      },
    },
  },
};
