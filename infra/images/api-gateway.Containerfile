# The API gateway's image (docs/06 §7, docs/19 §2). Built from the repository root:
#   podman build -f infra/images/api-gateway.Containerfile .
# The context is an allow-list (.containerignore): no .env, no .data, no tests.

# Pinned by digest, the Node release of .node-version (docs/versions.md).
ARG NODE_IMAGE=docker.io/library/node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66

FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
WORKDIR /app
# pnpm at the exact version of `packageManager`, through corepack.
RUN corepack enable
COPY . .
# Production dependencies of the gateway and of the workspace packages it imports, from the
# lockfile as it is. The packages stay where they are and are linked as in development, not copied
# into node_modules: Node strips TypeScript types everywhere but under node_modules.
RUN --mount=type=cache,id=atlasbi-pnpm-store,target=/pnpm-store \
    pnpm install --prod --frozen-lockfile --store-dir /pnpm-store \
      --filter '@atlasbi/api-gateway...'
# Never development tooling at runtime (build step 6, Phase C): the build fails instead.
RUN forbidden=$(ls node_modules/.pnpm | grep -E '^(typescript|vite|vitest|svelte)@|^@(vitest|sveltejs)\+' || true); \
    if [ -n "$forbidden" ]; then echo "development tooling in the runtime image: $forbidden" >&2; exit 1; fi

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
# Owned by root, run as `node`: the process cannot change its own code.
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
USER node
EXPOSE 4100
CMD ["node", "packages/api-gateway/src/main.ts"]
