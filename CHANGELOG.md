# Changelog

All notable changes to Kurultay are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A **Workspace** section in Settings — renaming and deleting a workspace no longer require
  `curl`. `PATCH /workspaces/:workspaceId` and `DELETE /workspaces/:workspaceId` existed from
  the start, but nothing in the product called either. Rename (OWNER/ADMIN, matching the
  endpoint's own `@WorkspaceRoles` gate) only ever sends `name` — `slug` stays untouched,
  because nothing under `apps/web/app/(app)` resolves a route or a link by it, so a slug
  editor here would be a control with no visible effect. Delete (OWNER only) requires typing
  the workspace's exact name before the button will accept a click: the cascade behind it
  (audit finding DB-06) removes every board, column, task, and comment in one statement, with
  no soft-delete stage and no automated backup to fall back on, so a single "Delete this
  workspace?" click is not proportionate friction for an unrecoverable action. Deleting clears
  the session's active workspace the same way `Leave workspace` does — dropping the socket and
  redirecting to the dashboard — because the workspace this whole screen was scoped to no
  longer exists to redirect back into. All copy is catalogued under `app.settings.workspace.*`.
- A **Members** section in Settings — the product can now start the flow it is built around.
  Every membership endpoint already existed; none of them had a screen, so inviting a teammate
  meant a `curl` call and the accept page served invitations nobody could send. Settings now
  carries the whole lifecycle: an email + role invite form, the queue of invitations still
  waiting to be accepted (with a copy-link control for installs whose outbound mail is not
  configured yet, and revoke), the roster with role changes and removal, and **Leave
  workspace** on the signed-in user's own row. What the API refuses, the UI does not offer: a
  MEMBER sees the roster and no management control at all, an ADMIN sees no menu on an OWNER's
  row, and OWNER is never an invitable role. The refusals that remain are stated as the move
  that would work — the last-OWNER `409` reads "This is the only owner. Make someone else an
  owner first." rather than a generic failure. All copy is catalogued under
  `app.settings.members.*`.
- `GET /workspaces/:workspaceId/invitations` — a cursor page of the invitations still awaiting
  an answer, so an admin can see and withdraw what they sent. OWNER/ADMIN only, unlike the
  roster beside it: an invited address belongs to someone who has agreed to nothing yet, and a
  GUEST reading the queue would be handed contact details the product never showed them.
  Expired and already-answered invitations are left out — the list is for rows something can
  still be done to.
- A data-retention policy, and a nightly job that enforces it. Until now nothing in the
  product ever deleted a row on its own: expired `Session` rows kept their `ipAddress` and
  `userAgent` forever, expired `Verification` rows kept the e-mail address that requested
  them, and `Notification` and `Activity` — the two fastest-growing tables in the schema —
  grew without a ceiling. A BullMQ job on `REDIS_URL` now runs once a day and deletes expired
  sessions and verifications (their own `expiresAt` decides), notifications more than
  `NOTIFICATION_RETENTION_DAYS` past the moment they were **read** (default 90; unread
  notifications are never deleted, at any age), and activity older than
  `ACTIVITY_RETENTION_DAYS` (default 365). Either window accepts `0` for "keep forever", and
  `CLEANUP_ENABLED=false` switches the whole sweep off — checked at the point of deletion, so
  a job definition left in Redis by an earlier deployment cannot outlive the switch. Deletes
  are batched at 1000 rows per statement so a first run against a long-lived instance is not
  one long transaction holding locks and blocking autovacuum. Each run writes one JSON line to
  stdout carrying the per-table counts and nothing else — no identifiers, no payloads — even
  when every count is zero, so a job that stops running is visible by its silence. The sweep
  is deliberately global rather than workspace-scoped, which is the single sanctioned
  exception to the multi-tenant rule and is argued in the new
  [ADR 0020](docs/decisions/0020-data-retention.md) along with the choice to delete year-old
  activity rather than archive or keep it. One index came with it
  (`Notification_activityId_idx`): `activityId` is `ON DELETE SET NULL`, which Postgres runs
  per deleted row, so without it each batch of deleted activities meant one sequential scan of
  the whole notification table per row.
- The web app now sends the same class of baseline security headers the API already did
  (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`), via
  `apps/web/next.config.ts`'s `headers()`. Unlike the API's `default-src 'none'` — it renders
  no HTML — the web CSP is shaped for a real App Router application: `script-src`/`style-src`
  allow `'unsafe-inline'`, verified empirically to be required (Next's RSC hydration script and
  `next-themes`'s FOUC-prevention script are both inline, and Radix/`@dnd-kit` position
  elements via an inline `style` attribute CSP nonces cannot cover), and `connect-src` names
  the configured API origin plus its derived `ws(s)` origin so both the REST client and the
  Socket.io transport keep working. `Permissions-Policy` denies `camera`, `microphone`,
  `geolocation`, `payment`, `usb`, and `interest-cohort` (FLoC/Topics-API opt-out) — none of
  which the app ever requests. See `docs/architecture.md#11-security-headers` for the full
  header table across both processes.
- Bounded timeouts on the shared database connection pool (`apps/api/src/prisma/database.ts`):
  `DATABASE_POOL_CONNECTION_TIMEOUT_MS` (default `10000`) caps how long a request waits for a
  connection once the pool is at `DATABASE_POOL_MAX`, and `DATABASE_STATEMENT_TIMEOUT_MS`
  (default `30000`) caps how long a single statement may run before Postgres kills it. Neither
  existed before: `pg`'s own default for the former is `0` (wait forever), so a saturated pool
  turned into requests that never resolved instead of a clear error, and with no statement cap
  a runaway query could hold a connection indefinitely. Applied per connection this pool opens,
  so `prisma migrate deploy`/`dev` and `pnpm db:seed`'s own bulk operations — neither goes
  through this pool — are unaffected. `DATABASE_POOL_MAX` itself (already the pool's size knob)
  is now also documented in `.env.example` and `docs/development.md`, which it previously was
  not. See [docs/development.md#database-connection-pool](docs/development.md#database-connection-pool).
- Membership revocation — the half of the access lifecycle that was missing. Until now a user
  who joined a workspace could only be removed by deleting the workspace or editing the
  database by hand, and no role could be lowered. Three routes close that:
  `DELETE /workspaces/:workspaceId/members/:userId` and
  `PATCH /workspaces/:workspaceId/members/:userId/role` (both OWNER/ADMIN), and
  `POST /workspaces/:workspaceId/members/me/leave`, which every member may call for
  themselves at any role. A workspace can never be left without an OWNER: the last one cannot
  be removed, demoted or allowed to leave (`409`), an ADMIN can neither remove an OWNER nor
  change their role, and only an OWNER may promote someone to OWNER (`403`). Removal is
  addressed at another member — taking yourself out is `POST .../members/me/leave`, so an
  admin's mistake cannot lock the admin out. Access ends immediately in both directions: the
  next HTTP request from a removed member is a `404`, and their Socket.io board and
  notification rooms are dropped inside the same request, so no board or notification event
  reaches them afterwards. The Better Auth `/organization/*` HTTP paths these routes replace
  stay blocked at the mount, as before.
- Scheduled database backups with a rehearsed restore path. `docker compose up` now starts a
  `backup` sidecar (`postgres:18-alpine`, `restart: unless-stopped`, waits for a healthy
  `postgres`) that runs `scripts/backup.sh`: every `BACKUP_INTERVAL` seconds it writes a
  `pg_dump --format=custom` archive to `/backups/kurultay-<UTC timestamp>.dump` in the new
  `backup_data` volume — via a `.part` file renamed on success, so an interrupted dump never
  looks like a finished archive — and prunes to the newest `BACKUP_KEEP` archives. The
  defaults (`86400`/`7`, both compose-only settings in `.env.example`) give a recovery point
  at most 24 hours old and a week of history on a self-hosted instance that nobody has to
  remember to back up. `docker-compose.dev.yml` is deliberately unchanged. The restore
  procedure in `docs/development.md` is now step-by-step and was rehearsed end to end —
  a seeded database dumped by the script and restored with `pg_restore` into an empty server
  reproduced all 17 tables, every row count, all 59 indexes, `pg_trgm`, and
  `_prisma_migrations` — with stated RPO ≤ 24 h / RTO ≤ 2 h targets and a warning that a
  volume on the same disk is not disaster protection.
- Structured HTTP access logging and request correlation. Every request is assigned an id —
  a safe inbound `X-Request-Id` is reused so an id minted by a proxy survives, anything else
  is replaced by a generated UUIDv7 — and it comes back in the `X-Request-Id` response
  header. Each finished request writes one JSON line to stdout
  (`{ts, level, requestId, method, path, status, durationMs, userId?}`); bodies, query
  strings, headers and cookies are never logged. The same id is appended to 5xx log lines
  and returned as `requestId` in the error envelope, so a reported failure names exactly one
  request. Both middlewares run ahead of the Better Auth mount, which bypasses the Nest
  router, so sign-in traffic and unmatched routes are logged too.
- `GET /health/ready` — an unauthenticated readiness probe that checks Postgres (`SELECT 1`)
  and Redis (`PING`) in parallel, each bounded by a 2s timeout so a wedged dependency answers
  `down` instead of leaving the probe hanging. `200` when the instance can serve traffic,
  `503` when it cannot, with the same `{ status, checks }` body either way so the caller can
  see which dependency failed. Redis reports `skipped` where `REDIS_URL` is unset, which is a
  supported single-instance configuration and does not make the instance unready. `GET /health`
  stays exactly as it was — liveness, dependency-free, so a dependency blip never gets a
  healthy API restarted.

### Changed

- CI gate job: `.github/workflows/ci.yml` now defines a single required status check, `ci-ok`,
  instead of relying on multiple job names in branch protection. The gate runs only when all
  upstream jobs (lint, test, build) have completed, and fails if any is not successful — even
  if skipped or cancelled via concurrency — preventing PRs from silently passing when a job is
  renamed or a workflow is cancelled. See [docs/testing.md](docs/testing.md#ci) and
  [#145](https://github.com/dravcore/kurultay/issues/145).
- **BREAKING:** `docker-compose.yml` and `docker-compose.dev.yml` no longer bake a fixed
  `kurultay`/`kurultay` Postgres password (or a passwordless Redis by omission of any choice)
  into the compose files themselves — every container on the same Docker network could
  previously connect to the database with a password identical across every Kurultay install,
  with no separate secret to guess. `POSTGRES_PASSWORD` is now a required `.env` value with no
  default, using the same fail-loud pattern as `BETTER_AUTH_SECRET`: `docker compose config`/
  `up` refuses to start until it is set. `POSTGRES_USER`/`POSTGRES_DB` keep the `kurultay`
  default so an otherwise-unmodified `.env` still works once the password is filled in, and
  `REDIS_PASSWORD` is new and optional — leaving it unset keeps `redis` passwordless exactly
  as before, so this half is not a breaking change on its own. See
  [docs/development.md#database-and-cache-credentials](docs/development.md#database-and-cache-credentials).

  **Migration for existing installs:** add `POSTGRES_PASSWORD=<your-password>` to `.env`
  before the next `docker compose up` — without it, compose now fails before creating a single
  container. **Picking a value here does not, by itself, change anything about an already
  initialized database:** the official Postgres image applies `POSTGRES_PASSWORD` only during
  `initdb`, i.e. only the very first time the `postgres_data` volume is created, so an existing
  volume keeps the role's original password no matter what `.env` now says. Two ways to bring
  them back in sync:
  - Set `POSTGRES_PASSWORD` in `.env` to whatever the running role's password **already is**
    (`kurultay`, if this is the first time upgrading past this change) — the value only needs
    to be present and correct, not different from today.
  - Or actually rotate the role's password to a new value, on the running instance, before
    updating `.env` to match:

    ```bash
    docker compose exec -T postgres psql -U kurultay -d postgres \
      -c "ALTER USER kurultay WITH PASSWORD 'the-new-password';"
    ```

    then set `POSTGRES_PASSWORD=the-new-password` in `.env` and restart the stack. Doing this
    out of order — restarting with a `.env` password that does not match the volume's actual
    role password — makes `migrate`/`api` fail to authenticate against a Postgres container
    that otherwise reports healthy.
- Docker Compose now survives crashes and host reboots: every long-running service carries
  `restart: unless-stopped` (in `docker-compose.dev.yml` too; the one-shot `migrate` job is
  deliberately excluded), `api` gains a healthcheck against `GET /health/ready` so "healthy"
  means DB and Redis actually answer, `web` gains a root-page healthcheck, and `web` now waits
  on `api` being *healthy* rather than merely started.
- Docs consistency pass: Node ≥24, i18n status, squash policy, archive links,
  project-skeleton archived, TR design status synced.
- Documentation map sharpened for post-MVP: `docs/README.md` is a five-minute reading guide;
  `docs/roadmap.md` is status + Beyond MVP only; Phase 0–9 checklists moved to
  `docs/archive/roadmap-mvp-phases.md`; shipped phase design specs moved to
  `docs/archive/specs/` (CHANGELOG links updated).

### Fixed

- The dashboard no longer greets a first visit with "Your boards couldn't load." in
  development. The board list and the dashboard summary share one boards `GET` so a single
  screen does not ask twice, but the shared request was created with the abort signal of
  whichever component happened to ask first. React StrictMode runs effects
  mount→cleanup→mount, so that first component's cleanup aborted the request everyone was
  waiting on, and the remount plus its sibling — which had asked for nothing to be cancelled —
  read the cancellation as a failed load. The shared request is no longer bound to any one
  subscriber's lifetime; unmount safety already comes from each subscriber ignoring results it
  no longer wants.
- Signing in returns the visitor to the page that sent them there. `/login` and `/register`
  were ignoring the `?next=…` both the route guard and the invitation screen had been writing
  into their URLs, so an invitee who followed an invitation link landed on the dashboard and
  had to find the invitation email again. The destination is now honoured on both screens and
  carried across the link between them — but only when it is a same-origin path, so a crafted
  `?next=https://evil.com` cannot turn the sign-in form into a phishing hop.

### Security

- Rate limiting across the whole API surface. A global `ThrottlerGuard` gives every route
  100 requests per minute per client IP, with tighter budgets where a request is expensive
  or reaches outside the process: 10/min on invitation creation (each one hands a message to
  the SMTP relay, addressed by the caller) and 30/min on task search (`?q=` is a trigram
  scan — the same route without `q=` keeps the default, so ordinary board paging is
  untouched). `/health` and `/health/ready` are exempt, because a throttled probe reports a
  healthy API as down. Over-budget requests get `429` in the standard error envelope with a
  `Retry-After` header. `/auth/*` bypasses the Nest router (ADR 0004), so Better Auth's own
  limiter is now configured explicitly rather than left on its production-only default, and
  its counters go to Redis via `rateLimit.customStorage` when `REDIS_URL` is set — shared
  across instances and surviving restarts, without moving sessions out of Postgres the way
  `secondaryStorage` would. No Redis is still a supported configuration: the counters stay in
  memory and a warning says so. `RATE_LIMIT_ENABLED=false` turns both limiters off for the
  integration suite. See [api-conventions.md](docs/api-conventions.md#rate-limiting).
- Rate limiting now counts the real client behind a reverse proxy, instead of the proxy's own
  address for every request. A new `TRUST_PROXY` variable (off by default — safe for a
  directly-exposed instance) sets Express's `trust proxy`, which both the `ThrottlerGuard`'s
  default tracker and the access log's new `ip` field read from `req.ip`. Better Auth's own
  rate limiter turned out not to consult that setting at all — it re-parses
  `X-Forwarded-For` itself and, without further configuration, accepted a single-value header
  outright even with no proxy in front of the app, letting a directly-exposed instance's
  `/auth/*` sign-in limit be bypassed by rotating a fabricated header. It is now pointed at a
  private header the app stamps with the same Express-resolved address on every request,
  overwriting anything a client sent, so both routers key on one value computed once. See
  [api-conventions.md](docs/api-conventions.md#rate-limiting).
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
