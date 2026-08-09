# Architecture

The shape of the Kurultay system: how the code is stored, how it runs, and how the data is modelled.

> 🌐 English (canonical) | [Türkçe](tr/architecture.md)

## Contents

- [1. Decision summary](#1-decision-summary)
- [2. Monorepo layout](#2-monorepo-layout)
- [3. apps/api — module map](#3-appsapi--module-map)
- [4. apps/web — structure](#4-appsweb--structure)
- [5. packages/shared-types](#5-packagesshared-types)
- [6. Data model](#6-data-model)
- [7. Multi-tenant isolation](#7-multi-tenant-isolation)
- [8. Runtime evolution](#8-runtime-evolution)
- [9. Decision records](#9-decision-records)

---

## 1. Decision summary

Kurultay is a **monorepo** containing a **modular monolith**.

These are two independent axes, and keeping them apart matters:

| Axis                       | Question it answers       | Kurultay's answer                    |
| -------------------------- | ------------------------- | ------------------------------------ |
| Monorepo vs. polyrepo      | How is the code _stored_? | Monorepo (single pnpm workspace)     |
| Monolith vs. microservices | How does the code _run_?  | Modular monolith (single deployable) |

**Why monorepo**

- Frontend and backend are both TypeScript, so `packages/shared-types` can hold one definition of task/board types. A data model change happens in one place.
- Single maintainer / small team: two repos means two PRs and manual version alignment for every cross-cutting change.
- Contribution barrier: a contributor clones one repo and runs `docker compose up`.
- Most reference projects in this space (Plane, Huly) are monorepos.

**Why modular monolith, not microservices**

- Microservices buy independent scaling at the cost of distributed-system complexity: inter-service calls, distributed transactions, separate deploy pipelines, distributed observability. At MVP scale there is nothing to scale independently yet.
- Kanban is highly coupled by nature. Moving one task touches the task row, the activity log, notifications, and dashboard aggregates — one local transaction today, a distributed transaction if split.
- The data model is not settled. Drawing service boundaries early is the expensive kind of mistake: fixing a wrong split costs far more than splitting a monolith later.

**What the references do**

| Project | Approach                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plane   | Monolith at the core, plus two support services (Gateway = DB proxy, Pilot = integration surface)                                                                   |
| Linear  | One codebase, deployed as several workloads with different roles: WebSocket servers, public/private GraphQL API, background job runners — each scaled independently |
| Huly    | Monorepo with many services, at the cost of building their own Rush-based build system                                                                              |

Linear's model is the one Kurultay follows: **one codebase, several process roles when needed.** Running the WebSocket server as its own container means splitting the deployment, not the code.

Full rationale: [`decisions/0001-monorepo-modular-monolith.md`](decisions/0001-monorepo-modular-monolith.md).

---

## 2. Monorepo layout

```
kurultay/
├── apps/
│   ├── api/               # NestJS backend (modular monolith)
│   └── web/               # Next.js App Router frontend
├── packages/
│   ├── shared-types/      # TS types / DTOs shared by api and web
│   └── auth-access/       # Better Auth organization AC roles (api + web)
├── pnpm-workspace.yaml
├── docker-compose.yml
├── docker-compose.dev.yml
└── .env.example
```

The buildable step-by-step version of this tree lives in [project-skeleton.md](project-skeleton.md); the technology choices behind it are in [tech-stack.md](tech-stack.md).

---

## 3. apps/api — module map

Every module has the same skeleton: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`. Module boundaries are kept clean from day one — the ability to split process roles later depends entirely on that.

**Current vs planned:** after Phase 9, feature modules including `realtime` are implemented.
Treat the table below as the module map.

| Module         | Responsibility                                                     |
| -------------- | ------------------------------------------------------------------ |
| `auth`         | Better Auth integration, session handling, request user resolution |
| `workspace`    | Workspace CRUD, membership, invitations, roles                     |
| `board`        | Board and column management, column ordering                       |
| `task`         | Task CRUD, moving between columns, fractional-index reordering     |
| `label`        | Board-scoped labels and task-label assignment                      |
| `comment`      | Task comments                                                      |
| `activity`     | Append-only activity log (`payload` is Json)                       |
| `dashboard`    | Aggregation queries feeding the charts                             |
| `notification` | Notification fan-out, Redis-backed queue                           |
| `realtime`     | Socket.io gateway + `@socket.io/redis-adapter`                     |

Cross-cutting infrastructure:

| Module   | Responsibility                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common` | Guards, exception filters, decorators, shared Nest bootstrap — workspace scoping (guard-enforced today; request-scoped Prisma Client Extensions deferred) |
| `prisma` | Shared `pg` pool + Nest `PrismaService`; Better Auth uses the same pool                                                                                   |

Dependency direction: feature modules depend on `common` and `prisma`, never the reverse. `realtime` is a consumer of domain events, not a place where domain logic lives — so it can be lifted into its own process role without dragging business rules with it.

---

## 4. apps/web — structure

```
apps/web/
├── app/
│   ├── (auth)/            # login, register, invite — unauthenticated shell
│   ├── (app)/             # authenticated shell: sidebar + workspace switcher
│   │   ├── dashboard/
│   │   ├── workspaces/new/
│   │   └── board/[boardId]/
│   └── layout.tsx
├── components/
│   ├── layout/            # AppShell, Topbar, WorkspaceProvider, AppSidebar, SancakRail
│   ├── auth/              # shared auth form primitives
│   ├── brand/             # DamgaMark and other brand marks
│   ├── ui/                # shadcn/ui primitives (landed Phase 3)
│   ├── board/             # BoardList, BoardView, BoardColumn, dialogs
│   ├── task/              # TaskCard, TaskPanel, metadata editors, DnD helpers
│   └── dashboard/         # chart components (Phase 7+)
└── lib/
    ├── api.ts             # typed REST client
    ├── socket.ts          # Socket.io client (board realtime)
    ├── permissions.ts     # re-exports `@kurultay/auth-access`
    └── auth.ts            # Better Auth client
```

Two route groups split the layout tree: `(auth)` renders a bare shell, `(app)` renders the workspace chrome and assumes a session. Next.js middleware checks the Better Auth session cookie against `/auth/get-session` before `(app)` routes run; the client shell still bootstraps workspaces once the session is present. Board interaction uses `@dnd-kit` with the server as the source of truth — an optimistic move is reconciled against the API response and against inbound socket events.

---

## 5. packages/shared-types

The single source of truth for anything that crosses the wire. Backend and frontend import the same declarations, so a drift between them becomes a type error rather than a runtime surprise.

| Content         | Examples                                                                           |
| --------------- | ---------------------------------------------------------------------------------- |
| Enums           | `Priority`, `MemberRole`, `InvitationStatus`, `LabelColorSlot` (`slot-1`…`slot-8`) |
| DTO types       | Workspace, Board, Column, Task, Label, Invitation request/response shapes          |
| Pagination      | `CursorPage<T>` (default list shape; keyed on `id`)                                |
| Socket contract | Event name constants and their payload types                                       |

Better Auth organization **roles / access-control** live in `@kurultay/auth-access` (not in this package), so api and web share one AC definition without pulling Better Auth into the types package.

Enums and DTOs are **hand-maintained** to match the Prisma schema today; a mechanical Prisma→shared-types codegen path remains an aspiration (see ADR 0002). The package stays free of a runtime Prisma dependency. The Prisma 7 client still emits to `apps/api/src/generated/prisma` for Nest and the Better Auth adapter.

---

## 6. Data model

| Model             | Key fields                                                                                                                                          | Notes                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`            | `id`, `email`, `name`, `avatarUrl`, `createdAt`                                                                                                     | Identity, owned by Better Auth                                                                                                                                                                                  |
| `Workspace`       | `id`, `name`, `slug`, `createdAt`                                                                                                                   | Tenant root — everything hangs off this                                                                                                                                                                         |
| `WorkspaceMember` | `id`, `workspaceId`, `userId`, `role`                                                                                                               | Join table; `role` drives permissions                                                                                                                                                                           |
| `Board`           | `id`, `workspaceId`, `name`, `description`, `createdAt`                                                                                             | Boards belong to a workspace                                                                                                                                                                                    |
| `Column`          | `id`, `boardId`, `name`, `position`, `color`                                                                                                        | `position` orders columns within a board                                                                                                                                                                        |
| `Task`            | `id`, `boardId`, `columnId`, `title`, `description`, `priority`, `position`, `dueDate`, `estimatedMinutes`, `createdById`, `createdAt`, `updatedAt` | The core entity — see rules below                                                                                                                                                                               |
| `TaskAssignee`    | `id`, `taskId`, `userId`                                                                                                                            | Join table; multiple assignees per task                                                                                                                                                                         |
| `Label`           | `id`, `boardId`, `name`, `color`                                                                                                                    | Board-scoped. `color` stores a design-token slot name (`slot-1`…`slot-8`), resolved per theme — not a raw hex; see [design.md](design.md)                                                                       |
| `TaskLabel`       | `id`, `taskId`, `labelId`                                                                                                                           | Join table                                                                                                                                                                                                      |
| `Comment`         | `id`, `taskId`, `userId`, `body`, `createdAt`                                                                                                       |                                                                                                                                                                                                                 |
| `Activity`        | `id`, `workspaceId`, `taskId` (nullable), `userId`, `type`, `payload` (Json), `createdAt`                                                           | Append-only log. `workspaceId` is required and `taskId` is optional so that workspace-level events with no task — "board renamed", "member joined" — are representable, which is what the Phase 8 feed promises |

`Notification` is **not** in the Phase 1 schema. It is added in [roadmap Phase 8](roadmap.md#phase-8--activity-log-and-notifications) when the activity feed and in-app alerts land. Until then the `notification` Nest module folder exists as a stub only.

Invitations persist as `WorkspaceInvitation`, mapped from Better Auth's organization
plugin tables (Kurultay names, plugin `schema` config). Product language and REST
paths use **Workspace** — see [ADR 0004](decisions/0004-auth-better-auth.md#domain-mapping-organization--workspace).

Better Auth also manages the auth infrastructure tables `Session`, `Account`, and `Verification`, which are plugin-managed and deliberately omitted from the domain model table above.

### Critical field rules

These are non-negotiable; they are also recorded in `CLAUDE.md`.

| Rule                                                           | Reason                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every `id` is **UUIDv7** (`@default(uuid(7))`)                 | Time-ordered, so keys stay index-local on insert-heavy tables and serve as a stable pagination cursor. See [api-conventions.md](api-conventions.md#data-types)                                                                                             |
| `Task.position` and `Column.position` are **Float**, never Int | Fractional indexing. Inserting between positions `1` and `2` writes `1.5` — one row updated instead of renumbering the whole list. Applies to both cards and columns. See [`decisions/0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md) |
| `dueDate` and `estimatedMinutes` are **separate fields**       | "By when" and "how long" are different concepts; a future Gantt view needs both                                                                                                                                                                            |
| `priority` is **separate from labels**                         | Keeps filtering and dashboard aggregation clean — priority is an ordered scalar, labels are an unordered set                                                                                                                                               |
| `Activity.payload` is **Json**                                 | New activity types can be added without a schema migration                                                                                                                                                                                                 |

### Constraints and referential actions

The join tables carry a surrogate `id` for convenience, but the natural key is what the
database enforces:

| Constraint                                        | Prevents                                                                                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkspaceMember @@unique([workspaceId, userId])` | One user holding two roles in the same workspace                                                                                                                                                                    |
| `TaskAssignee @@unique([taskId, userId])`         | The same assignee counted twice in lists, notifications, and activity payloads                                                                                                                                      |
| `TaskLabel @@unique([taskId, labelId])`           | The same label attached twice                                                                                                                                                                                       |
| `Column @@unique([boardId, id])`                  | Exists solely so `Task` can declare a composite foreign key `(boardId, columnId) → Column(boardId, id)`, making "a task's column is on the task's board" a database guarantee rather than an application-only check |

**Deletes cascade deliberately.** Prisma's default action on a required relation is
`Restrict`, so leaving this unstated would mean board deletion _fails_ — the more surprising
of the two defaults. Owned children cascade
(`Workspace → Board → Column, Task → Comment, Activity, TaskAssignee, TaskLabel`).
References to `User` do not: a comment or activity row outliving its author is correct, and
deleting a user has to be a deliberate operation rather than a silent erasure.

---

## 7. Multi-tenant isolation

Every workspace is a tenant, and the isolation rule is absolute: **every query is scoped by `workspaceId`.**

That rule is enforced at the guard level today (request-scoped Prisma Client Extensions remain deferred), not re-implemented in each service:

1. A guard resolves the current user's membership in the requested workspace and rejects the request if there is none (404 for non-members — anti-enumeration).
2. The resolved `workspaceId` / membership role is attached to the request context.
3. Services read the scope from that context; repository access paths always filter on it.
4. Nested resources are validated through their parent chain (task → board → workspace) so a valid id from another tenant cannot be smuggled in.
5. Workspace/org **mutations** go through Nest `/workspaces/*` only — Better Auth `/auth/organization/*` mutation HTTP is firewalled so Nest policy cannot be bypassed.

Placing this in one layer means a new module inherits isolation by default. A module that reaches around it is a bug, not a variation in style. Membership `role` (`OWNER`/`ADMIN`/`MEMBER`/`GUEST`) is checked in the same layer for permission decisions. Scaffold controllers use `/workspaces/:workspaceId/...` so `WorkspaceGuard` can read `params.workspaceId` when handlers arrive.

---

## 8. Runtime evolution

The staged path is deliberate: the microservice door stays open, the cost is simply not paid up front.

| Stage       | Trigger             | Runtime                                                                                                           |
| ----------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| MVP         | Now                 | One NestJS process (`api`) + `web` + `postgres` + `redis`                                                         |
| Split roles | Traffic growth      | Same codebase, same image, different roles: `api`, `ws` (Socket.io), `worker` (queue) — three services in Compose |
| Extract     | A proven bottleneck | Pull _only_ that module into its own service                                                                      |

Reaching stage 2 requires no architectural change — clean NestJS module boundaries are the whole prerequisite. Stage 3 is only entered against evidence, never speculation.

---

## 9. Decision records

The reasoning behind each of these choices is recorded as an ADR:

| ADR                                                                                | Topic                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`0001-monorepo-modular-monolith.md`](decisions/0001-monorepo-modular-monolith.md) | Monorepo + modular monolith                             |
| [`0002-backend-stack.md`](decisions/0002-backend-stack.md)                         | NestJS 11 + Prisma 7 + PostgreSQL 18 + Redis 8          |
| [`0003-frontend-stack.md`](decisions/0003-frontend-stack.md)                       | Next.js 16 + Tailwind + shadcn/ui + @dnd-kit + Recharts |
| [`0004-auth-better-auth.md`](decisions/0004-auth-better-auth.md)                   | Better Auth with the organization plugin (→ Workspace)  |
| [`0005-realtime-socketio.md`](decisions/0005-realtime-socketio.md)                 | Socket.io + Redis adapter                               |
| [`0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md)             | Float positions for ordering                            |
| [`0007-license-agpl.md`](decisions/0007-license-agpl.md)                           | AGPL-3.0                                                |
| [`0008-git-flow-semver.md`](decisions/0008-git-flow-semver.md)                     | Git Flow + SemVer                                       |

Related: [tech-stack.md](tech-stack.md) · [project-skeleton.md](project-skeleton.md)
