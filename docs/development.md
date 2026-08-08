# Development

How to set up a Kurultay development environment and work in it day to day.

> 🌐 English (canonical) | [Türkçe](tr/development.md)

## Contents

- [Status: the skeleton does not exist yet](#status-the-skeleton-does-not-exist-yet)
- [Prerequisites](#prerequisites)
- [Clone and install](#clone-and-install)
- [Environment variables](#environment-variables)
- [Run modes](#run-modes)
- [pnpm scripts](#pnpm-scripts)
- [Database workflow](#database-workflow)
- [Upgrading and backups](#upgrading-and-backups)
- [Day-to-day loop](#day-to-day-loop)
- [Troubleshooting](#troubleshooting)

## Status: the skeleton does not exist yet

Kurultay is **pre-skeleton**. `apps/api`, `apps/web`, `packages/shared-types`,
`docker-compose.yml`, and the root `package.json` described below are **not in the
repository yet**.

This document is therefore not a report of what exists — it is the **contract for what the
skeleton must provide**. Whoever scaffolds the monorepo builds it so that every command on
this page works exactly as written. If reality and this document diverge after the skeleton
lands, one of the two is a bug and gets fixed in the same PR.

- Layout, Prisma models, and acceptance criteria: [project-skeleton.md](project-skeleton.md)
- When the skeleton is scheduled: [roadmap.md](roadmap.md) (Phase 1)
- Why each tool was chosen: [tech-stack.md](tech-stack.md)

## Prerequisites

| Tool | Version | Check | Notes |
|---|---|---|---|
| Node.js | 22 or newer | `node -v` | 22 is the floor — Node 20 is end-of-life (2026-04-30) and Prisma 7 needs ≥ 20.19.0 regardless. **24 LTS recommended** (Active LTS to 2028-04-30) |
| pnpm | 9 or newer | `pnpm -v` | Via Corepack: `corepack enable && corepack prepare pnpm@latest --activate`. Corepack is no longer bundled with Node ≥ 25 — there, `npm i -g corepack` first, or install pnpm standalone with `npm i -g pnpm` |
| Docker | any current | `docker -v` | Docker Desktop or Colima on macOS |
| Docker Compose | v2 (plugin) | `docker compose version` | `docker-compose` v1 is not supported |
| Git | 2.30+ | `git --version` | |

No local PostgreSQL or Redis installation is needed — both run in Docker.

## Clone and install

```bash
git clone https://github.com/dravcore/kurultay.git
cd kurultay
pnpm install          # installs every workspace package
```

The repository is a pnpm workspace (`apps/*`, `packages/*`). Always run `pnpm install` from
the repository root — never inside `apps/api` or `apps/web`.

## Environment variables

```bash
cp .env.example .env
```

Then fill in the blanks. `.env` is git-ignored and must never be committed.

| Variable | Example | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://kurultay:kurultay@localhost:5432/kurultay` | Prisma connection string |
| `REDIS_URL` | `redis://localhost:6379` | Socket.io adapter, caching |
| `BETTER_AUTH_SECRET` | *(generate)* | Session signing secret — required, no default |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Public URL of the web app |
| `API_PORT` | `4000` | NestJS listen port |
| `WEB_URL` | `http://localhost:3000` | CORS origin for the API |

Generate a secret with:

```bash
openssl rand -base64 32
```

**Adding a new environment variable is a three-step change**, and all three go in the same
PR: add it to the typed env schema, add it to `.env.example` with a safe placeholder, and
document it in the table above.

## Run modes

### Recommended: dev loop (services in Docker, apps on host)

Postgres and Redis run in containers; `api` and `web` run on the host with hot reload. This
is the fast loop — no image rebuild between code changes.

```bash
docker compose -f docker-compose.dev.yml up -d   # postgres + redis only
pnpm db:migrate                                  # apply migrations
pnpm dev                                         # api + web in parallel, hot reload
```

| URL | What |
|---|---|
| http://localhost:3000 | Web app (Next.js) |
| http://localhost:4000 | API (NestJS) |
| http://localhost:4000/health | Health check — must return 200 |

Stop the containers with `docker compose -f docker-compose.dev.yml down` (add `-v` to also
drop the database volume and start from a clean slate).

### Full stack in Docker

Everything containerized, closest to production. Use it to verify the Dockerfiles and
compose wiring, or when you just want to run Kurultay rather than develop it.

```bash
docker compose up --build
```

| | Dev loop | Full Docker |
|---|---|---|
| Hot reload | Yes | No — rebuild required |
| Startup after a code change | seconds | tens of seconds |
| Matches production | Partially | Yes |
| Use for | Everyday development | Verifying images, release checks, running the app |

## pnpm scripts

Run from the repository root.

| Script | Command | What it does |
|---|---|---|
| `dev` | `pnpm dev` | Runs `apps/api` and `apps/web` in parallel with hot reload |
| `build` | `pnpm build` | Builds every workspace package |
| `lint` | `pnpm lint` | ESLint + Prettier check across all packages |
| `test` | `pnpm test` | Runs the test suites of every workspace package |
| `db:migrate` | `pnpm db:migrate` | Applies Prisma migrations (creates one in dev if the schema changed) |
| `db:seed` | `pnpm db:seed` | Loads demo data: one workspace, one board, default columns, a handful of tasks. Under Prisma 7 the seed entry point is declared in `prisma.config.ts` — seeding is never automatic and must be invoked explicitly |
| `db:studio` | `pnpm db:studio` | Opens Prisma Studio at http://localhost:5555 |

To target a single workspace, use pnpm's filter flag:

```bash
pnpm --filter @kurultay/api dev
pnpm --filter @kurultay/web build
pnpm --filter @kurultay/api test
```

## Database workflow

```bash
# 1. Edit apps/api/prisma/schema.prisma
# 2. Create and apply a migration
pnpm db:migrate
# 3. Load demo data (empty boards are hard to develop against)
pnpm db:seed
# 4. Inspect the data
pnpm db:studio
```

Rules:

- Migrations are **committed**. Never edit an already-committed migration file — write a
  new one.
- Schema changes go in their own PR, separate from the logic that uses them, whenever that
  split is practical.
- `Task.position` and `Column.position` are `Float` (fractional indexing) — see
  [project-skeleton.md](project-skeleton.md) for the model-level rules that must not be
  changed casually.

Resetting a local database from scratch:

```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm db:seed
```

## Upgrading and backups

This applies to anyone running Kurultay with data they care about, not to throwaway local
databases. Pre-1.0, breaking schema changes can ship in any `0.y.0` release
([git-strategy.md](git-strategy.md#versioning-policy-semver)), so the rule is simple:

**Dump the database before every upgrade.**

```bash
docker compose exec -T postgres pg_dump -U kurultay kurultay > kurultay-$(date +%F).sql
```

- Read the `CHANGELOG.md` entry for the target version first — every breaking change carries
  a migration note there.
- Then upgrade the images and run the migrations.

**PostgreSQL major-version upgrades need a dump and restore.** The official `postgres` image
refuses to start when the `PGDATA` volume was initialized by a different major version
("database files are incompatible with server"); the volume does not migrate itself. To move
from one major to the next: `pg_dump` on the old image, start the new major against an empty
volume, `psql`/`pg_restore` the dump. Minor upgrades (18.4 → 18.5) are in-place and need no
dump — the pre-upgrade backup above is still the sane habit.

**Redis is not backed up.** It holds cache, sessions, rate-limit counters, the Socket.io
pub/sub fan-out, and the notification queue — all rebuildable. Losing it logs everyone out
and drops queued notifications that had not been delivered yet; it loses no board data.
Redis upgrades within a major, and 7 → 8, are in-place and RDB/AOF compatible.

## Day-to-day loop

```bash
# 1. Start from an up-to-date develop and branch
git switch develop && git pull
git switch -c feature/board-drag-and-drop

# 2. Bring the services up (once per session)
docker compose -f docker-compose.dev.yml up -d
pnpm dev

# 3. Write code + tests

# 4. Verify locally before pushing
pnpm lint
pnpm build
pnpm --filter @kurultay/api test

# 5. Commit in Conventional Commits format, in English
git commit -m "feat(web): add drag-and-drop to the kanban board"

# 6. Push and open a PR against develop
git push -u origin feature/board-drag-and-drop
```

CI runs the same lint, typecheck, and test steps on every PR — running them locally first
just saves a round trip. Branch naming, commit format, and the PR/release process are
specified in [git-strategy.md](git-strategy.md).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:5432` | Postgres container is not up | `docker compose -f docker-compose.dev.yml up -d` |
| `Environment variable not found: DATABASE_URL` | `.env` missing | `cp .env.example .env` and fill it in |
| Port 3000/4000/5432 already in use | Another process or a stale container | `docker compose down`, or change the port in `.env` |
| Prisma types out of date after pulling | Client not regenerated | `pnpm db:migrate` (or `pnpm --filter @kurultay/api exec prisma generate`) |
| `pnpm install` fails with a workspace error | Ran inside a sub-package | Run it from the repository root |

## See also

- [project-skeleton.md](project-skeleton.md) — the layout and acceptance criteria this
  document is the contract for
- [roadmap.md](roadmap.md) — phase order
- [git-strategy.md](git-strategy.md) — branches, commits, releases
- [coding-standards.md](coding-standards.md) — how the code inside these apps is written
- [testing.md](testing.md) — how to run and write tests
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — contribution process
