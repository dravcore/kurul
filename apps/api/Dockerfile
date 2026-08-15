FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS build
# prisma.config.ts eagerly reads DATABASE_URL (via env()) as soon as it's loaded, which
# happens for `prisma generate` too even though generation never connects to a database.
# This placeholder only needs to be well-formed, never a real, reachable database.
ARG DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV DATABASE_URL=$DATABASE_URL
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml prisma.config.ts ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/auth-access/package.json packages/auth-access/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @kurultay/shared-types build \
  && pnpm --filter @kurultay/auth-access build \
  && pnpm db:generate \
  && pnpm --filter @kurultay/api build \
  && pnpm --filter @kurultay/api deploy --prod /app/deploy

# One-shot migration runner: reuses the full workspace already assembled in `build`
# (root scripts, prisma CLI, schema/migrations) rather than reinstalling anything.
# Not part of the app's runtime image — invoked as its own compose service.
FROM build AS migrate
CMD ["pnpm", "db:migrate"]

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/deploy/dist ./dist
COPY --from=build --chown=node:node /app/deploy/node_modules ./node_modules
COPY --from=build --chown=node:node /app/deploy/package.json ./package.json
# Attachments are written here at runtime (STORAGE_PATH, docker-compose.yml) — the first
# writable path this image has ever needed. It must exist and be owned by the unprivileged
# `node` user (uid 1000) *before* root is dropped, because an empty named volume mounted over
# a path takes the ownership of the mount point it finds in the image: create it here and the
# volume comes up `node:node`, leave it out and Docker creates it `root:root` and every upload
# fails with EACCES. Creating it in the image rather than chowning at boot is also what keeps
# docker-compose.yml's "never chowns" claim — and with it `cap_drop: [ALL]` — true. Same shape
# as apps/web/Dockerfile's .next/cache.
RUN mkdir -p /data/attachments && chown -R node:node /data
# Run as the unprivileged `node` user (uid 1000) shipped with node:24-alpine.
# dist + node_modules are read-only at runtime; /data above is the one writable path.
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
