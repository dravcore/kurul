# Changelog

All notable changes to Kurultay are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Docs consistency pass: Node ≥24, i18n status, squash policy, archive links,
  project-skeleton archived, TR design status synced.
- Documentation map sharpened for post-MVP: `docs/README.md` is a five-minute reading guide;
  `docs/roadmap.md` is status + Beyond MVP only; Phase 0–9 checklists moved to
  `docs/archive/roadmap-mvp-phases.md`; shipped phase design specs moved to
  `docs/archive/specs/` (CHANGELOG links updated).

### Fixed

- Signing in returns the visitor to the page that sent them there. `/login` and `/register`
  were ignoring the `?next=…` both the route guard and the invitation screen had been writing
  into their URLs, so an invitee who followed an invitation link landed on the dashboard and
  had to find the invitation email again. The destination is now honoured on both screens and
  carried across the link between them — but only when it is a same-origin path, so a crafted
  `?next=https://evil.com` cannot turn the sign-in form into a phishing hop.

### Security

- The API now sends baseline security headers on every response via `helmet`
  (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, and friends). The CSP is API-shaped
  (`default-src 'none'`) because the service renders no HTML, and `Cross-Origin-Resource-Policy`
  is `cross-origin` so the web app on `WEB_URL` keeps its CORS-gated access.

## [0.1.0] - 2026-08-12

First release: roadmap Phases 1–9 — the MVP — together with the post-MVP hardening pass that
followed them. Everything below had been accumulating under `[Unreleased]` since the first
commit; this is the point it becomes a version.

### Added

- The notification bell subscribes to `notification:unread-changed` instead of relying on a
  poll. The event is a signal, not the notification: the badge only needs a number, so the
  client answers with one integer and refetches the list only when it is open. Polling stays
  as a fallback for what a socket cannot cover — its own absence — at 120s and paused while
  the tab is hidden.
- CodeQL analysis and a blocking `pnpm audit --audit-level high` step run on every pull
  request.
- Interface language is a stored user preference
  ([ADR 0018](docs/decisions/0018-localization-strategy.md)). `User.locale` holds a nullable
  IETF tag, a **Settings → Language** screen writes it and mirrors it into a `locale` cookie,
  and `apps/web/i18n/request.ts` resolves each render through
  `User.locale → locale cookie → Accept-Language → 'en'`. There is no `[locale]` path segment
  and no i18n middleware. `null` is a real state, distinct from `'en'`: it means "follow my
  browser", and the picker exposes it as **Match my browser**.

  English is still the only language on offer — this is the mechanism, not the translation.
  Adding a second one is a change to `SUPPORTED_LOCALES` plus the two places that then fail to
  compile (the API's seed-column names and the missing `messages/<tag>.json`); no migration and
  no backfill.
- `PATCH /me` writes the caller's own profile. Session-guarded and not role-gated, since the
  subject is the caller; `locale` is the only editable field today.
- `POST /workspaces/:workspaceId/boards/:boardId/columns/defaults` seeds an empty board's
  starting columns in one transaction and returns them. Replaces the three sequential POSTs the
  web made, which could fail halfway and leave a board holding two of the three stages with no
  way to tell that from a set the user had trimmed. Same roles as creating a single column;
  `409` when the board already has columns, so a double-click cannot produce two Done columns.
- New boards are seeded with columns named in the creator's language — resolved from
  `User.locale`, falling back to `Accept-Language`. `ColumnCategory` still travels with each
  seed column, so a translated Done column keeps counting as completed
  ([ADR 0019](docs/decisions/0019-column-category.md)).
- Column settings replace the rename-column dialog and set a column's name and category
  together. Without a way to say that "Shipped" means completed, the metrics fix above only
  applies to columns still called Done.
- Contributor License Agreement scaffolding for the dual-licensing model
  ([ADR 0014](docs/decisions/0014-dual-licensing-cla.md)): Harmony-derived CLA draft
  ([docs/cla.md](docs/cla.md), EN/TR) — **not in force, pending legal review** — plus a
  merge-blocking `CLA` workflow, a CONTRIBUTING section, and a PR-template checkbox.
- `GET /workspaces/:workspaceId/members/me` returns the caller's own membership, so the app
  shell resolves the active role from one indexed row instead of `/me` plus the full roster.
- Phase 9 realtime board sync
  ([spec](docs/archive/specs/2026-08-09-phase-9-realtime-design.md)): Socket.io gateway with Redis
  adapter, session-cookie auth, `board:{id}` rooms, thin ID event contract (`actorId`),
  emit-after-commit from task/column/comment mutations, web `useBoardSocket` with reconnect
  resync and mid-drag cancel. Presence remains out of MVP; notification unread push shipped separately, above.
- Deferred follow-ups: `/notifications` page (unread + type filters, cursor Load more,
  View all from the bell) and dashboard created-vs-completed throughput (14 UTC days;
  `task.moved` payloads include column names). See
  [deferred notes](docs/archive/specs/2026-08-09-phase-8-deferred.md) (archived; open items
  moved to [roadmap.md](docs/roadmap.md#beyond-mvp)).
- Phase 8 activity log and notifications
  ([spec](docs/archive/specs/2026-08-09-phase-8-activity-notifications-design.md)): activity writes
  on task create/update/move/delete/assign/comment; workspace and task feeds; `Notification`
  model (assignment, mention, due-soon via BullMQ); shell bell + task History; comment
  `@[Name](userId)` mentions. Email deferred
  ([notes](docs/archive/specs/2026-08-09-phase-8-deferred.md), archived).
- Phase 7 dashboard
  ([spec](docs/archive/specs/2026-08-09-phase-7-dashboard-design.md)):
  `GET .../dashboard/summary?boardId?` with total/overdue tiles, priority and assignee
  charts, optional per-board column chart (Recharts), empty/loading states; completion
  over time now on `throughput` (Activity-backed).
- Phase 6 filtering and search
  ([spec](docs/archive/specs/2026-08-09-phase-6-filtering-design.md)): whitelisted `TaskQueryDto`
  on `GET .../boards/:boardId/tasks` (`q`, priority, assignee, label, due-date null/range,
  sort), cursor pagination (`CursorPage<TaskDto>`), filter indexes, and a URL-synced board
  filter bar with chips, `/` search focus, and empty state.
- Phase 5 task metadata
  ([spec](docs/archive/specs/2026-08-09-phase-5-task-metadata-design.md)): board label CRUD with
  `LabelColorSlot` colors, task assignees/labels, priority/`dueDate`/`estimatedMinutes`
  on `PATCH` tasks, comments, [ADR 0011](docs/decisions/0011-label-task-metadata-permissions.md),
  enriched `TaskDto`/`CommentDto`/`WorkspaceMemberDto`, and panel/card UI for metadata.
- Phase 4 tasks and drag-and-drop
  ([spec](docs/archive/specs/2026-08-09-phase-4-tasks-design.md)): workspace-scoped task CRUD,
  fractional `Task.position` moves with on-demand rebalance,
  [ADR 0010](docs/decisions/0010-task-permissions.md) (MEMBER+ mutate), `@dnd-kit`
  multi-column board with optimistic move + toast rollback, and a title/description
  detail panel at `/board/[boardId]/task/[taskId]`.
- Visual debt closure and Phase 4 groundwork
  ([spec](docs/archive/specs/2026-08-09-visual-debt-design.md)): design.md type-scale tokens,
  reduced-motion policy that keeps color/opacity, shared `DamgaMark`, token-themed sonner
  toasts with retry actions, elevation tokens, shared 48px topbar, workspace switcher
  dropdown (usable from the collapsed rail), sliding sancak rail, shell loading skeleton,
  auth screens on the identity system (Fraunces display + damga + ui primitives), board
  column stagger on first paint, board card hover/focus states, and a11y fixes
  (`aria-current`, `menuitemradio` switcher, `main` landmark).
- Phase 3 boards and columns: workspace-scoped board/column CRUD, default columns on
  board create, Float fractional column reordering with on-demand rebalance helper,
  [ADR 0009](docs/decisions/0009-board-column-permissions.md) role matrix, design tokens
  (light/dark), Archivo/Fraunces/JetBrains typography, shadcn primitives, board list and
  board page shell with column dialogs.
- Phase 0 documentation and standards: governance files, process docs, architecture docs,
  ADRs 0001–0008, EN/TR mirrors, and repository branch protection / merge defaults.
- Phase 1 monorepo skeleton: pnpm workspace (`apps/api`, `apps/web`,
  `packages/shared-types`), NestJS + Prisma schema/migration/seed, Next.js + next-intl
  placeholder login, Docker Compose, and CI workflow.
- Phase 2 auth and workspaces: Better Auth (organization plugin) on Nest `/auth/*`,
  `GET /me`, session/workspace/role guards, workspace CRUD + invitations, web
  login/register/invite + workspace switcher, and auth/isolation/role-matrix tests.
- `@kurultay/auth-access` — shared Better Auth organization access-control roles for api
  and web.
- Shared Prisma/`pg` pool for Nest and Better Auth; FK and list query indexes migration;
  workspace-nested scaffold routes (`/workspaces/:workspaceId/...`).
- Web: typed Nest API client, Next.js middleware session gate, layout split
  (`WorkspaceProvider` / `AppSidebar` / `AppShell`).
- CI `format:check` (Prettier) on every PR.

### Changed

- The interface speaks one vocabulary. A task is a task, never a card; an invitation is an
  invitation, never an invite; the copy and the message keys both say "confirm" for email
  confirmation rather than the keys saying "verify" while the copy said "confirm"; role names
  are lowercase in prose. Two pairs of identical strings living under different keys were
  collapsed — harmless while English is the only language, guaranteed to drift once it is not.
- Success messages are the exception rather than the default. `docs/design.md` §7 now states
  the rule — a message exists only where the screen cannot already answer "did that work?" —
  and only three flows meet it: column settings, where `category` has no on-screen
  representation; accepting an invitation, which lands on a dashboard that never mentions it;
  and deleting a board label, which strips it from every task while the screen shows one chip.
  Creating, deleting, moving, renaming and commenting confirm themselves.
- Every error ends with a way out, and §7 records how that is decided: if the identical request
  could succeed on a second attempt the surface carries a control, otherwise the sentence
  carries the next move. An explained failure never gets a retry button, because one that
  re-fails on every press teaches the user the product is broken — and a control still on
  screen and still live already is the retry.

- Kurultay no longer accepts external code, documentation, or translation contributions
  ([ADR 0015](docs/decisions/0015-no-external-contributions.md)): the codebase stays
  single-authored, the CLA draft is kept but not enacted, and legal review is deferred to the
  first commercial sale. The `CLA` workflow is disabled (manual trigger only, plus an
  `if: false` job guard) rather than deleted, so no contributor is asked to sign a draft
  agreement for a pull request that would not be merged. CONTRIBUTING, the PR template, and
  `docs/cla.md` (EN/TR) now state the pause is indefinite.
- Docs: README and process docs reflect MVP complete (Phases 1–9); Turkish architecture
  module map aligned with English; api-conventions / testing / development status wording
  updated for shipped realtime.
- Docs: `docs/decisions/0011-label-task-metadata-permissions.md` superseded on the comment-delete
  rule by [ADR 0012](docs/decisions/0012-comment-delete-authorship.md) (author OR OWNER/ADMIN,
  not any MEMBER); `docs/archive/specs/2026-08-09-phase-8-deferred.md` archived to
  `docs/archive/specs/` with its remaining open follow-ups folded into
  [roadmap Beyond MVP](docs/roadmap.md#beyond-mvp); api-conventions, tech-stack, testing, and
  architecture docs refreshed to match the shipped activity/dashboard/notification routes, ADRs
  0009–0012, web Vitest in CI, next-intl, and the develop merge-commit practice actually in use.
- Tooling: type-aware ESLint (floating-promise, React hooks rules), Husky pre-commit, Dependabot,
  and CI coverage; added comment/label guardrail unit specs.
- Tech-debt refactor (Wave 5): centralized UUID/pagination/optional-DTO validation helpers and
  workspace-role decorators across API controllers, enriched `CreateTaskDto` label/assignee
  handling, and fixed board a11y (drag-handle ARIA, localized DnD announcements, mention
  combobox keyboard support).
- Tech-debt refactor (Wave 6): shared request DTOs in `@kurultay/shared-types`
  (`packages/shared-types/src/requests.ts`), split `board-view` and `task-metadata-panel` into
  focused modules/hooks, and added test coverage for `TaskService.remove`, `WorkspaceGuard`,
  notifications, and realtime edge cases.
- **Breaking:** `GET /workspaces/:workspaceId/boards/:boardId/tasks` now returns
  `CursorPage<TaskDto>` (`{ items, nextCursor, hasMore }`) instead of a bare `TaskDto[]`.
  Clients must drain pages (or raise `limit`, max 100) to load a full board.
- **Breaking:** `GET /workspaces/:workspaceId/members` now returns
  `CursorPage<WorkspaceMemberDto>` (`{ items, nextCursor, hasMore }`) instead of a bare
  `WorkspaceMemberDto[]` capped at 1000 rows, and accepts `?limit=` (default and max 100)
  and `?cursor=`. Clients drain pages — `fetchAllWorkspaceMembers` in
  `apps/web/lib/member-query.ts` — instead of trusting a single response to hold the whole
  roster.
- Nest `/workspaces` is the sole public API for organization/workspace mutations; Better
  Auth `/auth/organization/*` mutation paths are HTTP-firewalled (reads + `set-active`
  remain).
- Pagination docs: cursor `CursorPage<T>` is the shared typed default; no `OffsetPage`
  export.
- Product enums in `@kurultay/shared-types` include `InvitationStatus` and
  `LabelColorSlot` (`slot-1`…`slot-8`); invitation DTO status is no longer a free string.
- ESLint docs aligned with the flat config actually shipped (no Nest/Next/import plugins
  yet).

### Removed

- Tech-debt cleanup: unused `ts-node` from `apps/api` (`@prisma/client` was later restored —
  Prisma 7 needs the package physically present for `prisma generate` even with a custom
  `output` path); dead
  `NotificationService.createDueSoon` (the due-soon worker batches inserts directly) and the
  `dashboard-throughput` helpers (`isDoneColumnName`, `isCompletedMove`, `applyThroughputCounts`)
  that only specs exercised; stale `.gitkeep` placeholders in directories that now hold real
  files; unused `--ease-in-out` / `--ease-drawer` CSS tokens.

### Fixed

- Failure messages name the thing that actually failed. **Add column** and **Add task** failed
  with "Could not *create* this column/task", breaking the verb halfway through the flow;
  posting or deleting a comment fell through to "Could not save this task."; deleting a board
  label reported itself as an update.

- Failed loads no longer report as empty successes. A failed notification load said "You're
  caught up" while unread items existed, a cold deep link to a task flashed "This task no
  longer exists", a failed metadata load read as "No comments yet", and a board list with no
  active workspace yet blamed a request that was never made. `useBoardData` also passed
  "task is missing" as the error message for *every* failure, so a network error claimed the
  task had been deleted; it now reads the status and only says that on a `404`.
- `app/(app)/error.tsx`, `app/error.tsx` and `not-found.tsx` keep a render error or a dead
  link inside the design system. A broken board now keeps the sidebar, switcher and bell
  rather than dropping the user onto an unstyled page.
- Label colours are named — blue, orange, aqua, yellow, magenta, green, violet, red, the
  vocabulary `docs/design.md` §8 already used — instead of rendering the storage slot ids
  `slot-1`…`slot-8` on screen.
- A 150-minute estimate renders as "2h 30m" rather than "150m", with the phrasing owned by
  the message catalogue so word order stays translatable.
- Renaming a board's Done column no longer zeroes its completion and throughput metrics
  ([ADR 0019](docs/decisions/0019-column-category.md)). Columns carry a `ColumnCategory`
  (`BACKLOG` / `UNSTARTED` / `STARTED` / `COMPLETED` / `CANCELED`) that the dashboard reads
  instead of matching the column's name against `'done'`, so "Shipped", "Released" or a
  column seeded in another language counts as finished work. Completion is a *set* of
  columns: a board may mark more than one column `COMPLETED`. Only `COMPLETED` is consumed
  today; the other four are vocabulary for later.

  > **Upgrade note — one-time, manual.** The migration backfills `COMPLETED` where
  > `lower(btrim(name)) = 'done'`, which is the same rule the retired matcher used. **A board
  > whose Done column had already been renamed reports zero completions until someone opens
  > column settings and sets its category.** The backfill cannot recover intent from an
  > arbitrary name — that is the whole reason the name stopped being the carrier — so there is
  > nothing to guess from and no way to detect the affected boards. Those dashboards were
  > already reporting zero before this release; the fix is available to them, it is just not
  > automatic. Set the category once per affected column and the last 14 days of moves start
  > counting immediately.
- Tech-debt correctness pass (Wave 2): reject `null` on non-nullable update DTOs, preserve
  column `taskCount` after rebalance, map Prisma errors, fix dashboard "Other" assignee
  buckets, opaque `board:join` denies, scoped task updates, and board-view retry/patch/ref bugs.
- Tech-debt performance and resource pass (Wave 3): enable Nest shutdown hooks and Better Auth
  session cookie cache, batch due-soon scans and rebalance SQL, paginate comments, and add
  `pg_trgm` search indexes.

[unreleased]: https://github.com/dravcore/kurultay/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dravcore/kurultay/releases/tag/v0.1.0
