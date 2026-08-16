# Project Skeleton (historical)

> **Archived Phase 1 scaffold.** Current layout and module map:
> [../architecture.md](../architecture.md). Day-to-day map: [../README.md](../README.md).
> This file is how the monorepo was first built — not a checklist for new work.

A step-by-step reference for building the Kurul monorepo skeleton: workspace, apps, schema, containers, and the checks that say it is done.

> 🌐 English (canonical) | [Türkçe](../tr/project-skeleton.md)

**Package name:** `kurul` · **Organization:** dravcore · **License:** AGPL-3.0 · **Architecture:** monorepo + modular monolith

## Contents

- [0. Preflight](#0-preflight)
- [1. Monorepo setup](#1-monorepo-setup)
- [2. packages/shared-types](#2-packagesshared-types)
- [3. apps/api — NestJS 11](#3-appsapi--nestjs-11)
- [4. apps/web — Next.js 16](#4-appsweb--nextjs-16)
- [5. Docker Compose](#5-docker-compose)
- [6. .env.example](#6-envexample)
- [7. Repository files](#7-repository-files)
- [8. Verification — skeleton is done when](#8-verification--skeleton-is-done-when)
- [9. First features, in order](#9-first-features-in-order)

---

## 0. Preflight

```bash
node -v                  # 22+ (24 LTS recommended)
docker -v
docker compose version
pnpm -v
```

Name checks, as they resolved: the npm package name `kurul` is available and still
unclaimed — nothing is published yet. `github.com/dravcore/kurul` was taken and is where
this lives. `kurul.dev` was **not** available; no domain is registered, and the project is
reachable only through the repository. A domain decision is still open.

> **Name origin (historical).** The project was called Kurultay when this scaffold was
> written; it was renamed **Kurul** before v0.2.0, when `kurultay` turned out to be taken as a
> domain. The note below is left as it was — this is an archive, and the reasoning it records
> is still why the shorter name was chosen.
>
> A _kurultay_ is the great assembly of the Turkic-Mongol tradition, where the tribes gathered, debated, decided, and divided the work — a fair description of what the tool does. (`kurul` is the Turkish spelling; `kurultai` the Mongolian/English transliteration.) The README should tell this story.

---

## 1. Monorepo setup

pnpm workspaces (npm workspaces would also work; pnpm wins on disk usage and install speed).

```
kurul/
├── apps/
│   ├── api/                 # NestJS backend
│   └── web/                 # Next.js frontend
├── packages/
│   ├── shared-types/        # TS types / DTOs shared by api and web
│   └── auth-access/         # Better Auth organization AC roles (api + web)
├── pnpm-workspace.yaml
├── package.json
├── prisma.config.ts         # required by Prisma 7 — schema path, seed entry, env loading
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

| Script       | Does                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`        | Run `api` and `web` in parallel                                                                                                                                        |
| `build`      | Build every workspace package                                                                                                                                          |
| `lint`       | Lint every workspace package                                                                                                                                           |
| `test`       | Run tests in every workspace package                                                                                                                                   |
| `db:migrate` | Run Prisma migrations                                                                                                                                                  |
| `db:seed`    | Load demo data (one workspace, board, columns, a few tasks). Prisma 7 removed automatic seeding — the entry point is declared in `prisma.config.ts` and run explicitly |
| `db:studio`  | Open Prisma Studio                                                                                                                                                     |

---

## 2. packages/shared-types

TypeScript types shared between frontend and backend — hand-maintained DTOs/enums aligned with
the Prisma schema (codegen remains aspirational), plus the socket contract.

| Content            | Detail                                            |
| ------------------ | ------------------------------------------------- |
| `Priority` enum    | `LOW \| MEDIUM \| HIGH \| URGENT`                 |
| `MemberRole` enum  | `OWNER \| ADMIN \| MEMBER \| GUEST`               |
| `InvitationStatus` | `pending \| accepted \| canceled \| rejected`     |
| `LabelColorSlot`   | `slot-1`…`slot-8` (never raw hex)                 |
| DTO types          | Task, Board, Column, Label, Workspace, Invitation |
| `CursorPage<T>`    | Default list pagination shape                     |
| Socket events      | Event name constants and payload types            |

### packages/auth-access

Better Auth organization access-control roles (`OWNER` / `ADMIN` / `MEMBER` / `GUEST`) shared
by `apps/api` and `apps/web`. Peer-depends on `better-auth`; keep role statements in sync here,
not by copying `permissions.ts` between apps.

---

## 3. apps/api — NestJS 11

Bootstrap target: **NestJS 11** (pinned major; NestJS 12 ESM migration was still in draft at Phase 0).

```
apps/api/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── generated/prisma/  # Prisma 7 client output — git-ignored, generated
│   ├── common/            # guards, interceptors, filters, decorators
│   ├── prisma/            # PrismaService + shared pg pool factory
│   ├── auth/              # Better Auth integration (+ org HTTP firewall)
│   ├── workspace/         # workspace CRUD + membership/invitations
│   ├── board/             # scaffold: /workspaces/:workspaceId/boards
│   ├── task/              # scaffold: /workspaces/:workspaceId/tasks
│   ├── label/
│   ├── comment/
│   ├── activity/          # activity log
│   ├── dashboard/         # aggregation queries
│   ├── notification/
│   └── realtime/          # Socket.io gateway + Redis adapter
└── package.json
```

**Every module has the same skeleton:** `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`.

Keep module boundaries clean from the start — the option to split a module into its own process or service later depends on it. See [architecture.md](../architecture.md) for the module map and the staged runtime plan.

### Prisma schema — initial tables

_The schema below is the Phase 1 starting point; the live source of truth is `apps/api/prisma/schema.prisma`, which later phases extend (Phase 2 added `Session`, `Account`, `Verification`, `WorkspaceInvitation`)._

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
Label           id, boardId, name, color   # color = design-token slot name (slot-1..8), not hex
TaskLabel       id, taskId, labelId
Comment         id, taskId, userId, body, createdAt
Activity        id, workspaceId, taskId?, userId, type, payload(Json), createdAt
```

`Notification` was deferred from the Phase 1 schema to [roadmap Phase 8](archive/roadmap-mvp-phases.md#phase-8--activity-log-and-notifications) — not created in the first migration. Invitations are owned by Better Auth (organization plugin), not a Prisma model here; see [ADR 0004](../decisions/0004-auth-better-auth.md#domain-mapping-organization--workspace).

**Critical details**

| Rule                                                                      | Why                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every `id` is `@id @default(uuid(7))`                                     | UUIDv7 (Prisma ≥ 5.18) — time-ordered, so primary keys stay index-local on the insert-heavy task/comment/activity tables _and_ are usable as a stable pagination cursor. See [api-conventions.md](../api-conventions.md#pagination)           |
| `Task.position` and `Column.position` are **Float**, not Int              | Fractional indexing — a card or column dropped between `1` and `2` becomes `1.5`, so only the moved row is written instead of renumbering the list. See [`decisions/0006-fractional-indexing.md`](../decisions/0006-fractional-indexing.md)   |
| `dueDate` and `estimatedMinutes` are **separate fields**                  | "By when" and "how long" are different concepts; a later Gantt view needs both                                                                                                                                                                |
| `priority` stays **separate from labels**                                 | Clean filtering and dashboard aggregation                                                                                                                                                                                                     |
| Multi-tenant isolation                                                    | Every query is scoped by `workspaceId`, enforced at guard/interceptor level — never re-implemented per service                                                                                                                                |
| `Activity.payload` is **Json**                                            | New activity types need no schema migration                                                                                                                                                                                                   |
| `Activity.taskId` is **nullable**, `Activity.workspaceId` is **required** | Phase 8 promises a workspace-level feed. "Board renamed", "member joined", "column deleted" are workspace events with no task to hang off — the shape has to allow them from the first migration, or Phase 8 needs a migration and a backfill |

**Constraints that must be in the first migration**

Adding these later means cleaning duplicate rows first, so they land with the schema:

| Constraint                                        | Prevents                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `WorkspaceMember @@unique([workspaceId, userId])` | The same user joining a workspace twice with two different roles — leaving "which role wins?" undefined                  |
| `TaskAssignee @@unique([taskId, userId])`         | The same assignee attached twice; doubles up in list responses, notification fan-out, and activity payloads              |
| `TaskLabel @@unique([taskId, labelId])`           | The same label attached twice                                                                                            |
| `Column @@unique([boardId, id])`                  | Nothing on its own — it exists so `Task` can declare a composite foreign key `(boardId, columnId) → Column(boardId, id)` |

That composite FK is the point of the last one: `Task` carries both `boardId` and `columnId`
as a query convenience, and without it nothing at the data layer stops the two from
desyncing — a raw query, a bulk import, or a future migration script can move a task to a
column on another board and no constraint catches it. `422 Unprocessable Entity`
([api-conventions.md](../api-conventions.md#http-verbs-and-status-codes)) then becomes the
application-level expression of a rule the database also enforces, not the only line of
defence.

**Cascade behaviour is explicit, not defaulted.** Prisma's default referential action for a
required relation is `Restrict`, which means silence here resolves to the surprising
outcome: deleting a board would _fail_ rather than cascade. Owned children cascade:

```
Workspace → Board → Column, Task → Comment, Activity, TaskAssignee, TaskLabel
```

Each of those relations is declared `onDelete: Cascade`. References to _shared_ rows do not
cascade: `Task.createdById`, `Comment.userId`, `Activity.userId`, and `TaskAssignee.userId`
point at `User` and stay `Restrict` — deleting a user must be a deliberate operation, not a
side effect that silently erases their comments.

### Prisma 7 — what the version costs

Prisma 7 dropped the Rust query engine, which is why it was chosen
([`decisions/0002-backend-stack.md`](../decisions/0002-backend-stack.md)). It is not a free
upgrade, and each of these shapes the skeleton rather than being a detail discovered later:

| Requirement                           | Effect on the skeleton                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A driver adapter is mandatory         | `@prisma/adapter-pg` is a dependency of `apps/api`, and `PrismaService` owns a `pg` Pool's lifecycle in `OnModuleInit`/`OnModuleDestroy` — not just a connection string                                                                                                                                                               |
| `prisma.config.ts` at the repo root   | Replaces env-var config inside `schema.prisma`, and declares the seed entry point (`db:seed` above)                                                                                                                                                                                                                                   |
| Generator `output` is required        | The client is no longer emitted into `node_modules`. It goes to `apps/api/src/generated/prisma` for Nest and the Better Auth adapter. Shared DTO/enums in `@kurul/shared-types` are hand-maintained to match the schema today; mechanical codegen remains aspirational ([architecture.md](../architecture.md#5-packagesshared-types)) |
| Client middleware (`$use`) is removed | Any query-level cross-cutting concern — the `workspaceId` scoping helper, a compare-and-swap guard on `position` — is a **Client Extension** now. Design for extensions from the start; there is no middleware to fall back to                                                                                                        |
| Env vars are not auto-loaded          | `dotenv` is called explicitly. `.env.example` below still describes the same variables; only the loading is manual                                                                                                                                                                                                                    |

Minimum versions that follow from this: Node ≥ 20.19.0 (the project's floor is higher — see
[development.md](../development.md#prerequisites)) and TypeScript (see root `package.json`).

---

## 4. apps/web — Next.js 16

Bootstrap target: **Next.js 16** (App Router).

```
apps/web/
├── middleware.ts                # session gate for protected app routes
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── register/
│   ├── (app)/
│   │   ├── layout.tsx           # AppShell + workspace switcher
│   │   ├── dashboard/
│   │   └── board/[boardId]/
│   └── layout.tsx
├── components/
│   ├── ui/                      # shadcn/ui
│   ├── layout/                  # AppShell, AppSidebar, WorkspaceProvider
│   ├── auth/                    # shared auth form fields
│   ├── board/                   # KanbanBoard, Column, TaskCard (Phase 3+)
│   ├── task/                    # TaskDetailPanel (Phase 3+)
│   └── dashboard/               # chart components (Phase 7+)
├── lib/
│   ├── api.ts                   # typed Nest API client
│   ├── socket.ts                # Socket.io client
│   └── auth.ts                  # Better Auth client
└── package.json
```

Setup: Next.js (App Router) + Tailwind + `shadcn/ui` init + `@dnd-kit/core` + `@dnd-kit/sortable` + `recharts` + `socket.io-client` + `next-intl` (the i18n layer is wired from the first component — see [design.md](../design.md)).

---

## 5. Docker Compose

`docker-compose.yml` — the full stack:

| Service    | Detail                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `postgres` | `postgres:18-alpine`, named volume, healthcheck                                                   |
| `redis`    | `redis:8-alpine`, named volume                                                                    |
| `api`      | Built from `apps/api` Dockerfile; `depends_on` postgres + redis with `condition: service_healthy` |
| `web`      | Built from `apps/web` Dockerfile; `depends_on` api                                                |

Both tags are pinned deliberately. **Redis 8, not 7:** the `redis:7` band is RSALv2/SSPLv1
only — source-available, not OSI open source. Redis 8 restored an OSI licence, and that
licence is AGPLv3 — the same one Kurul ships under
([`decisions/0007-license-agpl.md`](../decisions/0007-license-agpl.md)), so the compose file a
self-hoster runs is licence-aligned end to end. **Postgres 18** is the current major;
bumping majors later costs every self-hoster a dump and restore
([development.md](../development.md#upgrading-and-backups)), so it is done now while no data
exists.

`docker-compose.dev.yml` — development only: brings up **postgres and redis alone**, while `api` and `web` run on the host with hot reload. This shortens the development loop considerably.

---

## 6. .env.example

```
DATABASE_URL=postgresql://kurul:kurul@localhost:5432/kurul
REDIS_URL=redis://localhost:6379
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:4000
API_PORT=4000
WEB_URL=http://localhost:3000
```

The real `.env` must be in `.gitignore`.

---

## 7. Repository files

| File                       | Content                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                | What it does, screenshot (later), quick start (`docker compose up`), stack list, contribution link                                                                                                                                                                                                                                                                                                                                  |
| `LICENSE`                  | AGPL-3.0 — its network-use clause means anyone running a modified Kurul as a service must release their modifications, which removes the incentive for a closed-source SaaS fork without forbidding commercial hosting. Leaves an open-core path available. Relaxing AGPL later requires every contributor's consent, so it must be right from the start. See [`decisions/0007-license-agpl.md`](../decisions/0007-license-agpl.md) |
| `CONTRIBUTING.md`          | Environment setup, commit convention, PR process                                                                                                                                                                                                                                                                                                                                                                                    |
| `CODE_OF_CONDUCT.md`       | Contributor Covenant                                                                                                                                                                                                                                                                                                                                                                                                                |
| `.github/workflows/ci.yml` | lint + typecheck + test + build, on push and PR                                                                                                                                                                                                                                                                                                                                                                                     |

---

## 8. Verification — skeleton is done when

```bash
docker compose up            # every service comes up
pnpm db:migrate              # migration succeeds
curl localhost:4000/health   # returns 200
# localhost:3000 opens and renders the login page
pnpm lint && pnpm test && pnpm build   # no errors
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

Related: [architecture.md](../architecture.md) · [tech-stack.md](../tech-stack.md)
