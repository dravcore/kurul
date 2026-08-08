# Project Skeleton

A step-by-step reference for building the Kurultay monorepo skeleton: workspace, apps, schema, containers, and the checks that say it is done.

> 🌐 English (canonical) | [Türkçe](tr/project-skeleton.md)

**Package name:** `kurultay` · **Organization:** dravcore · **License:** AGPL-3.0 · **Architecture:** monorepo + modular monolith

## Table of contents

- [0. Preflight](#0-preflight)
- [1. Monorepo setup](#1-monorepo-setup)
- [2. packages/shared-types](#2-packagesshared-types)
- [3. apps/api — NestJS](#3-appsapi--nestjs)
- [4. apps/web — Next.js](#4-appsweb--nextjs)
- [5. Docker Compose](#5-docker-compose)
- [6. .env.example](#6-envexample)
- [7. Repository files](#7-repository-files)
- [8. Verification — skeleton is done when](#8-verification--skeleton-is-done-when)
- [9. First features, in order](#9-first-features-in-order)

---

## 0. Preflight

```bash
node -v                  # 20+
docker -v
docker compose version
pnpm -v
```

Name checks: the npm package name `kurultay` is available. Remaining: `github.com/dravcore/kurultay`, and a domain (`kurultay.dev` / `kurultay.io`).

> **Name origin.** A *kurultay* is the great assembly of the Turkic-Mongol tradition, where the tribes gathered, debated, decided, and divided the work — a fair description of what the tool does. (`kurultay` is the Turkish spelling; `kurultai` the Mongolian/English transliteration.) The README should tell this story.

---

## 1. Monorepo setup

pnpm workspaces (npm workspaces would also work; pnpm wins on disk usage and install speed).

```
kurultay/
├── apps/
│   ├── api/                 # NestJS backend
│   └── web/                 # Next.js frontend
├── packages/
│   └── shared-types/        # TS types shared by api and web
├── pnpm-workspace.yaml
├── package.json
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── .gitignore
├── README.md
├── LICENSE
└── CONTRIBUTING.md
```

**pnpm-workspace.yaml**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

Root `package.json` scripts:

| Script | Does |
|---|---|
| `dev` | Run `api` and `web` in parallel |
| `build` | Build every workspace package |
| `lint` | Lint every workspace package |
| `db:migrate` | Run Prisma migrations |
| `db:studio` | Open Prisma Studio |

---

## 2. packages/shared-types

TypeScript types shared between frontend and backend — DTOs and enums derived from the Prisma-generated models, plus the socket contract.

| Content | Detail |
|---|---|
| `Priority` enum | `LOW \| MEDIUM \| HIGH \| URGENT` |
| `MemberRole` enum | `OWNER \| ADMIN \| MEMBER \| GUEST` |
| DTO types | Task, Board, Column, Label, Workspace |
| Socket events | Event name constants and payload types — one source of truth, so frontend and backend cannot drift |

---

## 3. apps/api — NestJS

```
apps/api/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/            # guards, interceptors, filters, decorators
│   ├── prisma/            # PrismaService (global module)
│   ├── auth/              # Better Auth integration
│   ├── workspace/         # workspace CRUD + membership/invitations
│   ├── board/             # board + column management
│   ├── task/              # task CRUD, moving, ordering
│   ├── label/
│   ├── comment/
│   ├── activity/          # activity log
│   ├── dashboard/         # aggregation queries
│   ├── notification/
│   └── realtime/          # Socket.io gateway + Redis adapter
└── package.json
```

**Every module has the same skeleton:** `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`.

Keep module boundaries clean from the start — the option to split a module into its own process or service later depends on it. See [architecture.md](architecture.md) for the module map and the staged runtime plan.

### Prisma schema — initial tables

```
User            id, email, name, avatarUrl, createdAt
Workspace       id, name, slug, createdAt
WorkspaceMember id, workspaceId, userId, role
Board           id, workspaceId, name, description, createdAt
Column          id, boardId, name, position, color
Task            id, boardId, columnId, title, description,
                priority, position, dueDate, estimatedMinutes,
                createdById, createdAt, updatedAt
TaskAssignee    id, taskId, userId          # multiple assignees
Label           id, boardId, name, color
TaskLabel       id, taskId, labelId
Comment         id, taskId, userId, body, createdAt
Activity        id, taskId, userId, type, payload(Json), createdAt
```

**Critical details**

| Rule | Why |
|---|---|
| `position` is **Float**, not Int | Fractional indexing — a card dropped between `1` and `2` becomes `1.5`, so only the moved row is written instead of renumbering the list. See [`decisions/0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md) |
| `dueDate` and `estimatedMinutes` are **separate fields** | "By when" and "how long" are different concepts; a later Gantt view needs both |
| `priority` stays **separate from labels** | Clean filtering and dashboard aggregation |
| Multi-tenant isolation | Every query is scoped by `workspaceId`, enforced at guard/interceptor level — never re-implemented per service |
| `Activity.payload` is **Json** | New activity types need no schema migration |

---

## 4. apps/web — Next.js

```
apps/web/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── register/
│   ├── (app)/
│   │   ├── layout.tsx           # sidebar + workspace switcher
│   │   ├── dashboard/
│   │   └── board/[boardId]/
│   └── layout.tsx
├── components/
│   ├── ui/                      # shadcn/ui
│   ├── board/                   # KanbanBoard, Column, TaskCard
│   ├── task/                    # TaskDetailPanel
│   └── dashboard/               # chart components
├── lib/
│   ├── api.ts                   # backend client
│   ├── socket.ts                # Socket.io client
│   └── auth.ts                  # Better Auth client
└── package.json
```

Setup: Next.js (App Router) + Tailwind + `shadcn/ui` init + `@dnd-kit/core` + `@dnd-kit/sortable` + `recharts` + `socket.io-client`.

---

## 5. Docker Compose

`docker-compose.yml` — the full stack:

| Service | Detail |
|---|---|
| `postgres` | `postgres:17-alpine`, named volume, healthcheck |
| `redis` | `redis:7-alpine`, named volume |
| `api` | Built from `apps/api` Dockerfile; `depends_on` postgres + redis with `condition: service_healthy` |
| `web` | Built from `apps/web` Dockerfile; `depends_on` api |

`docker-compose.dev.yml` — development only: brings up **postgres and redis alone**, while `api` and `web` run on the host with hot reload. This shortens the development loop considerably.

---

## 6. .env.example

```
DATABASE_URL=postgresql://kurultay:kurultay@localhost:5432/kurultay
REDIS_URL=redis://localhost:6379
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000
API_PORT=4000
WEB_URL=http://localhost:3000
```

The real `.env` must be in `.gitignore`.

---

## 7. Repository files

| File | Content |
|---|---|
| `README.md` | What it does, screenshot (later), quick start (`docker compose up`), stack list, contribution link |
| `LICENSE` | AGPL-3.0 — prevents the code being resold as a closed-source SaaS, and leaves an open-core path available. Relaxing AGPL later requires every contributor's consent, so it must be right from the start. See [`decisions/0007-license-agpl.md`](decisions/0007-license-agpl.md) |
| `CONTRIBUTING.md` | Environment setup, commit convention, PR process |
| `CODE_OF_CONDUCT.md` | Contributor Covenant |
| `.github/workflows/ci.yml` | lint + typecheck + build, on push and PR |

---

## 8. Verification — skeleton is done when

```bash
docker compose up            # every service comes up
pnpm db:migrate              # migration succeeds
curl localhost:4000/health   # returns 200
# localhost:3000 opens and renders the login page
pnpm lint && pnpm build      # no errors
```

Once these pass, the skeleton is ready. There are no features yet, but from here every feature is "filling in an empty box".

---

## 9. First features, in order

1. Auth flow (register / login / session) + workspace creation
2. Board and column management (CRUD + column ordering)
3. Task CRUD + drag & drop (with fractional indexing)
4. Task metadata: multiple assignees, labels, priority, due date, estimate
5. Filtering and search
6. Dashboard + charts (aggregation endpoints + Recharts)
7. Activity log + notifications
8. Realtime sync (Socket.io)

Realtime comes last on purpose: the data flow has to settle first. Adding it early means updating socket events alongside every feature change.

Related: [architecture.md](architecture.md) · [tech-stack.md](tech-stack.md)
