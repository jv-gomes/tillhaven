# syntax=docker/dockerfile:1
#
# The API server, for AWS App Runner.
#
# **This image contains the server and nothing else.** The client is built
# separately and served by Netlify, so no Vite build runs here and no art is
# copied in — which also means the licensed asset pack (ATTRIBUTION.md) never
# touches this image. `apps/server/src/app.ts` serves the client only when
# `CLIENT_DIST` exists, so its absence is a supported configuration rather than
# a missing piece.
#
# Node 22 on Debian bookworm, not Alpine, and that is deliberate: argon2 is a
# native module and musl builds of it are a recurring source of "works on my
# machine". Bookworm's glibc matches the prebuilds.

# ------------------------------------------------------------------
# Stage 1 — dependencies and bundle
# ------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

# argon2 (CLAUDE.md §8's password hasher) compiles from source when no prebuild
# matches. These are needed for that fallback and are dropped with the stage.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Corepack pins pnpm to the version in package.json's `packageManager`, so the
# image resolves the lockfile the same way a developer does.
RUN corepack enable

WORKDIR /repo

# Manifests first, so a source-only change does not re-download the world.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/

# The client and mapmaker are not in this image, but the lockfile describes
# them, so `--frozen-lockfile` needs their manifests present to stay frozen.
COPY apps/client/package.json apps/client/
COPY apps/mapmaker/package.json apps/mapmaker/

RUN pnpm install --frozen-lockfile

# Only what the bundle actually reads.
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY tsconfig.base.json ./

# Typecheck before bundling: esbuild strips types without checking them, so
# without this the image would happily ship code `pnpm typecheck` rejects.
RUN pnpm --filter @tillhaven/server typecheck
RUN pnpm --filter @tillhaven/server bundle

# Production dependencies only, for copying into the runtime stage. Built here
# rather than in the runtime image so the compiler toolchain never ships.
RUN pnpm --filter @tillhaven/server deploy --prod --legacy /prod-server

# ------------------------------------------------------------------
# Stage 2 — runtime
# ------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
# App Runner's default listener. `env.ts` reads PORT, so this is the only place
# the number appears; change it here and in the App Runner service together.
ENV PORT=8080

WORKDIR /app

# `node` is created by the base image. Running as root in a container that
# takes public traffic is the kind of default nobody revisits.
COPY --from=build --chown=node:node /prod-server/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/server/dist ./dist
COPY --from=build --chown=node:node /repo/apps/server/package.json ./package.json

USER node

EXPOSE 8080

# App Runner has its own health check configured against this path; this one is
# for `docker run` and for anything else that reads the image's own opinion.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The bundle, not `dist/index.js`. See `apps/server/scripts/bundle.mjs` for why
# the tsc output cannot be started directly.
CMD ["node", "dist/server.js"]
