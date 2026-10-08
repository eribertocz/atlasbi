# The web app's image (docs/19 §1, §10): its static build, served by Caddy, which is also the
# platform's single HTTP entry point — it proxies /api and /auth to the API gateway. Built from the
# repository root:
#   podman build -f infra/images/web.Containerfile .
# The context is an allow-list (.containerignore): no .env, no .data, no tests.

ARG NODE_IMAGE=docker.io/library/node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66
# Pinned by the digest of its multi-platform index (docs/versions.md).
ARG CADDY_IMAGE=docker.io/library/caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f

FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
WORKDIR /app
RUN corepack enable
COPY . .
RUN --mount=type=cache,id=atlasbi-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --filter '@atlasbi/web...'
# A static build needs no configuration: the app talks to its own origin.
RUN pnpm --filter @atlasbi/web build

FROM ${CADDY_IMAGE}
COPY infra/images/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/build /srv
# Not root: the server listens on an unprivileged port and writes nothing.
USER nobody
EXPOSE 8080
