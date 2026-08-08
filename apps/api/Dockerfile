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
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @kurultay/shared-types build \
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
COPY --from=build /app/deploy/dist ./dist
COPY --from=build /app/deploy/node_modules ./node_modules
COPY --from=build /app/deploy/package.json ./package.json
EXPOSE 4000
CMD ["node", "dist/main.js"]
