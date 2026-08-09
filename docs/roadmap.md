# Roadmap

Phased delivery plan for Kurultay, from documentation to MVP and beyond.

> 🌐 English (canonical) | [Türkçe](tr/roadmap.md)

**Last updated:** 2026-08-09

## Contents

- [How this roadmap works](#how-this-roadmap-works)
- [Status legend](#status-legend)
- [Phase 0 — Documentation and standards](#phase-0--documentation-and-standards)
- [Phase 1 — Skeleton](#phase-1--skeleton)
- [Phase 2 — Auth and workspaces](#phase-2--auth-and-workspaces)
- [Phase 3 — Boards and columns](#phase-3--boards-and-columns)
- [Phase 4 — Tasks and drag-and-drop](#phase-4--tasks-and-drag-and-drop)
- [Phase 5 — Task metadata](#phase-5--task-metadata)
- [Phase 6 — Filtering and search](#phase-6--filtering-and-search)
- [Phase 7 — Dashboard](#phase-7--dashboard)
- [Phase 8 — Activity log and notifications](#phase-8--activity-log-and-notifications)
- [Phase 9 — Realtime](#phase-9--realtime)
- [Beyond MVP](#beyond-mvp)

## How this roadmap works

**This file holds high-level phases only.** Task-level tracking lives in GitHub Issues:
[github.com/dravcore/kurultay/issues](https://github.com/dravcore/kurultay/issues).

| Level    | Where                    | Granularity                                                        |
| -------- | ------------------------ | ------------------------------------------------------------------ |
| Phase    | This file                | "Boards and columns" — weeks of work, one coherent capability      |
| Task     | GitHub Issues            | "Column reorder endpoint returns 409 on cross-board move" — one PR |
| Decision | [decisions/](decisions/) | Why a phase is built the way it is                                 |

Phases ship in order. Each one ends in a working, merged, demonstrable state — no phase
leaves half-wired code on `develop`. A phase may map to a `0.y.0` release; see
[git-strategy.md](git-strategy.md#versioning-policy-semver).

The order is deliberate and is not a backlog to be reprioritized casually. Its rationale is
recorded in [project-skeleton.md](project-skeleton.md) and repeated per phase below.

## Status legend

| Mark  | Meaning                         |
| ----- | ------------------------------- |
| `[x]` | Done — merged to `develop`      |
| `[~]` | In progress                     |
| `[ ]` | Not started                     |
| `[-]` | Deferred / out of scope for now |

---

## Phase 0 — Documentation and standards

**Goal:** every project standard is written down before a line of application code exists.
**Status:** done

### Governance and community files

- [x] `LICENSE` — AGPL-3.0
- [x] `README.md` — what Kurultay is, status, quick start, stack
- [x] `CONTRIBUTING.md` — contribution process
- [x] `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1
- [x] `SECURITY.md` — vulnerability reporting policy
- [x] `CHANGELOG.md` — Keep a Changelog, starting at `[Unreleased]`
- [x] `.github/ISSUE_TEMPLATE/` — bug report and feature request forms
- [x] `.github/PULL_REQUEST_TEMPLATE.md`
- [x] `README.tr.md` — Turkish README

### Process documentation

- [x] `docs/git-strategy.md` — Git Flow, Conventional Commits, release process, SemVer
- [x] `docs/development.md` — environment setup and daily loop
- [x] `docs/coding-standards.md` — TypeScript, NestJS, Next.js conventions
- [x] `docs/design.md` — design principles, tokens, layout, motion, states, UI writing
- [x] `docs/testing.md` — test strategy and CI expectations
- [x] `docs/api-conventions.md` — REST, errors, pagination, DTOs
- [x] `docs/roadmap.md` — this file

### Architecture documentation

- [x] `docs/architecture.md` — modular monolith, module map, data model summary
- [x] `docs/tech-stack.md` — English canonical version
- [x] `docs/project-skeleton.md` — English canonical version
- [x] `docs/decisions/` — ADRs 0001–0009 + index

### Localization

- [x] `docs/tr/` — Turkish copy of every published process/architecture doc under `docs/`
      (excluding `docs/specs/`)
- [x] Cross-link check: every EN doc links its TR sibling and vice versa
- [x] `docs/tr/design.md` — Turkish mirror of the design document

### Repository configuration

- [x] `develop` branch created from `main`
- [x] Branch protection on `main` and `develop` (no direct pushes, PR required; status checks when CI exists)
- [x] "Delete branch on merge" and squash-merge defaults enabled

---

## Phase 1 — Skeleton

**Goal:** an empty but running monorepo. No business logic — every later feature becomes
"fill in the box."
**Reference:** [project-skeleton.md](project-skeleton.md)
**Status:** done

**This phase lands as one large maintainer-authored PR** — a documented exception to the
<500-line guideline in [CONTRIBUTING.md](../CONTRIBUTING.md). Scaffolding a pnpm workspace,
a NestJS app, a Next.js app, the Prisma schema, and Docker Compose does not decompose into
independently mergeable units; each half is unbuildable without the other. Every phase after
this one follows the usual size rule.

- [x] pnpm workspace: `apps/api`, `apps/web`, `packages/shared-types`, `pnpm-workspace.yaml`
- [x] Root `package.json` scripts: `dev`, `build`, `lint`, `test`, `db:migrate`, `db:seed`,
      `db:studio`
- [x] Shared tooling: TypeScript strict base config, ESLint, Prettier
- [x] `.env.example` and `.gitignore`
- [x] `docker-compose.yml` — postgres 18, redis 8, api, web (healthchecks + `depends_on`)
- [x] `docker-compose.dev.yml` — postgres + redis only
- [x] `apps/api` — NestJS bootstrap, `app.module.ts`, global `ValidationPipe`, exception filter
- [x] `apps/api` — empty module folders: `common/`, `prisma/`, `auth/`, `workspace/`,
      `board/`, `task/`, `label/`, `comment/`, `activity/`, `dashboard/`, `notification/`,
      `realtime/`
- [x] `prisma.config.ts` at the repo root (Prisma 7: schema path, seed entry, env loading)
- [x] Prisma schema — `User`, `Workspace`, `WorkspaceMember`, `Board`, `Column`, `Task`,
      `TaskAssignee`, `Label`, `TaskLabel`, `Comment`, `Activity`
- [x] Ids are `@default(uuid(7))`; `Task.position` and `Column.position` are `Float`;
      `dueDate` and `estimatedMinutes` are separate fields
- [x] Join-table unique constraints, the `Column @@unique([boardId, id])` composite FK, and
      explicit `onDelete` actions ([project-skeleton.md](project-skeleton.md#prisma-schema--initial-tables))
- [x] First migration committed — Phase 1 tables only; `Notification` is deferred to
      [Phase 8](#phase-8--activity-log-and-notifications)
- [x] `db:seed` — one demo workspace, board, default columns, a handful of tasks
- [x] `GET /health` returning 200
- [x] `apps/web` — Next.js App Router, Tailwind, shadcn/ui init, `@dnd-kit`, Recharts,
      `socket.io-client`, `next-intl` (i18n layer wired; strings through the catalog from
      the first component — [design.md](design.md) §7)
- [x] `apps/web` — route groups `(auth)/` and `(app)/`, placeholder login page
- [x] `packages/shared-types` — `Priority`, `MemberRole` enums; entity and page types
- [x] `.github/workflows/ci.yml` — lint + typecheck + test + build on push and PR

### Acceptance criteria

```bash
docker compose up            # all services come up healthy
pnpm db:migrate              # migration succeeds
pnpm db:seed                 # demo data loads
curl localhost:4000/health   # 200
# localhost:3000 renders the login page
pnpm lint && pnpm test && pnpm build   # no errors
```

---

## Phase 2 — Auth and workspaces

**Goal:** a user can sign up, log in, and own a workspace. Nothing else can be built
tenant-safely until this exists.
**Status:** done

- [x] Better Auth integration (organization plugin), session handling
- [x] Register / login / logout / session refresh
- [x] `GET /me`
- [x] Auth guard on all protected routes
- [x] **Workspace scoping guard** — every request resolves and verifies `workspaceId`
- [x] Workspace CRUD, slug uniqueness
- [x] Membership + roles: `OWNER`, `ADMIN`, `MEMBER`, `GUEST`; role guard
- [x] Invitations: create, accept, revoke
- [x] Web: login/register pages, session provider, workspace switcher, app shell layout
- [x] Tests: auth flows, workspace isolation, role matrix
      ([testing.md](testing.md#what-must-be-tested))
- [x] Phase 2 quality hardening (pre-boards): Nest-only workspace mutations (BA org HTTP
      firewall), shared `pg` pool, query indexes, `@kurultay/auth-access`, typed web API
      client + middleware session gate, workspace-nested scaffold routes, `format:check` in CI

---

## Phase 3 — Boards and columns

**Goal:** the container the Kanban actually lives in.
**Reference:** [design.md](design.md) — the binding reference for all board UI work from here on
**Status:** done

- [x] Web: design tokens (light + dark), typography, and app shell chrome per
      [design.md](design.md) §3–§4 — validate the proposed values on real screens and record
      any change back into that document
- [x] Board CRUD, scoped to workspace
- [x] Column CRUD
- [x] Column reordering (`position`)
- [x] Default columns on board creation (To Do / In Progress / Done)
- [x] Web: board list, board page shell, column rendering, create/rename/delete dialogs
- [x] Design.md §3–§4 validation on real screens — closed by the visual-debt stack
      ([spec](specs/2026-08-09-visual-debt-design.md)): type scale, toast, topbar, workspace
      switcher, sancak rail, auth identity treatment, board polish

---

## Phase 4 — Tasks and drag-and-drop

**Goal:** the core interaction of the product.
**Reference:** [design.md](design.md) §4–§5; [ADR 0010](decisions/0010-task-permissions.md);
[spec](specs/2026-08-09-phase-4-tasks-design.md)
**Status:** done

- [x] Task CRUD
- [x] **Fractional indexing** for `Task.position` — insert between, top, bottom, empty column
- [x] `PATCH .../tasks/:taskId/position` — move within and across columns
- [x] On-demand rebalancing: reflow a column when the gap between neighbours falls below the
      precision threshold, in the same transaction as the move (no scheduled job — see
      [`decisions/0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md))
- [x] Concurrent-move handling (deterministic `position, id` tie-break; rebalance on exhausted gaps)
- [x] Web: `@dnd-kit` board, optimistic reorder with rollback on failure
- [x] Web: task detail panel (title + description; metadata UI is Phase 5)
- [x] **Re-evaluate `@dnd-kit`** — kept classic pinned line; recorded in
      [`decisions/0003-frontend-stack.md`](decisions/0003-frontend-stack.md)
- [x] Tests: the full positioning matrix in [testing.md](testing.md#1-fractional-indexing-taskposition)

---

## Phase 5 — Task metadata

**Goal:** tasks carry enough information to be planned, not just listed.
**Status:** not started

- [ ] Multiple assignees (`TaskAssignee`)
- [ ] Labels: board-scoped CRUD, assign/unassign to tasks
- [ ] Priority (`LOW`/`MEDIUM`/`HIGH`/`URGENT`) — kept separate from labels
- [ ] `dueDate` and `estimatedMinutes` — separate fields, separate UI
- [ ] Comments on tasks
- [ ] Web: assignee picker, label picker, priority badge, date picker, comment thread

---

## Phase 6 — Filtering and search

**Goal:** boards stay usable past a few dozen cards.
**Status:** not started

- [ ] Query DTO with whitelisted filter/sort fields
      ([api-conventions.md](api-conventions.md#filtering-sorting-field-selection))
- [ ] Filters: assignee, label, priority, due date range, unassigned/no-due-date
- [ ] Free-text search over title and description
- [ ] Cursor pagination on task lists
- [ ] Indexes for the filtered/sorted columns
- [ ] Web: filter bar, active-filter chips, filter state in the URL

---

## Phase 7 — Dashboard

**Goal:** aggregate view across a workspace.
**Status:** not started

- [ ] Aggregation endpoints: tasks by status, by assignee, by priority; overdue count;
      completion over time
- [ ] Query performance pass on the aggregations
- [ ] Web: dashboard page with Recharts visualizations
- [ ] Empty and loading states

---

## Phase 8 — Activity log and notifications

**Goal:** users can see what changed and be told about it.
**Status:** not started

- [ ] `Activity` writes on task create/move/update/comment/assign (`payload` as JSON so new
      activity types need no migration)
- [ ] Activity feed endpoint (task-level and workspace-level), cursor-paginated
- [ ] `Notification` model (new migration): mention, assignment, due-soon — not present in
      the Phase 1 schema
- [ ] Mark read / mark all read
- [ ] Web: activity timeline in the task panel, notification centre
- [ ] `[-]` Email delivery — deferred beyond MVP

---

## Phase 9 — Realtime

**Goal:** two people on the same board see each other's changes live.
**Status:** not started

**Realtime is deliberately last.** Socket events mirror the data model, so every event
written before the model settles has to be rewritten with it. Building realtime on a stable
schema is one pass of work; building it early is a tax on all eight phases before it.

- [ ] Socket.io gateway with the Redis adapter (horizontal scaling)
- [ ] Socket auth using the existing session; **rooms scoped per workspace/board**
- [ ] Event contract in `@kurultay/shared-types` — single source for both sides
- [ ] Events: task created/updated/moved/deleted, column changed, comment added
- [ ] Web: subscribe on board mount, reconcile with local optimistic state, resync on
      reconnect
- [ ] Conflict behavior when a remote move lands mid-drag

---

## Beyond MVP

Not scheduled. Listed so the architecture stays compatible with them, not as commitments.

| Item                                                   | Note                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[-]` E2E test suite (Playwright)                      | Once the UI stops changing shape — [testing.md](testing.md)                                                                                                         |
| `[-]` Gantt / timeline view                            | `dueDate` + `estimatedMinutes` are kept separate for this                                                                                                           |
| `[-]` Task attachments                                 | Needs an object-storage decision (ADR)                                                                                                                              |
| `[-]` Board templates                                  |                                                                                                                                                                     |
| `[-]` Public API tokens + `/v1` prefix                 | Post-1.0 — [api-conventions.md](api-conventions.md#versioning)                                                                                                      |
| `[-]` Webhooks                                         |                                                                                                                                                                     |
| `[-]` Email notifications                              |                                                                                                                                                                     |
| `[-]` Import from Trello / Jira                        |                                                                                                                                                                     |
| `[-]` Further UI language packs                        | The next-intl layer itself ships in Phase 1 and MVP is English-only; this row is about additional locales (Turkish first) — see [design.md](design.md#7-ui-writing) |
| `[-]` Self-host deployment guide beyond Docker Compose |                                                                                                                                                                     |

**1.0.0** is cut when Phases 1–9 are complete and the REST API is stable enough to promise
backwards compatibility.

## See also

- [project-skeleton.md](project-skeleton.md) — Phase 1 in full detail
- [architecture.md](architecture.md) — how the modules fit together
- [git-strategy.md](git-strategy.md) — how a phase becomes a release
- [development.md](development.md) — how to build any of this locally
- [../CHANGELOG.md](../CHANGELOG.md) — what has actually shipped
- [GitHub Issues](https://github.com/dravcore/kurultay/issues) — task-level tracking
