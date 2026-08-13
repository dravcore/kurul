FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS build
# Next.js inlines NEXT_PUBLIC_* into the client bundle at build time, so it must be
# available before `next build` runs — setting it only at container runtime (as compose
# does for the API) would bake in the fallback below instead of the real value.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml prisma.config.ts ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/auth-access/package.json packages/auth-access/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @kurultay/shared-types build \
  && pnpm --filter @kurultay/auth-access build \
  && pnpm --filter @kurultay/web build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Next.js standalone binds to $HOSTNAME, and Docker sets HOSTNAME to the container ID —
# leaving this unset makes server.js listen only on eth0, so the in-container healthcheck
# (wget against localhost) gets connection refused. 0.0.0.0 listens on every interface.
ENV HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
# Next.js standalone writes its ISR/image cache here at runtime — it must exist
# and be writable by the unprivileged `node` user (uid 1000) before dropping root.
RUN mkdir -p apps/web/.next/cache && chown -R node:node apps/web/.next/cache
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
