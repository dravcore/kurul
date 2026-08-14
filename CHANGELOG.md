# Changelog

All notable changes to Kurultay are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **An activation funnel you can read about your own instance, and telemetry that is off.**
  Kurultay measured nothing about its own use — a grep for `telemetry`, `analytics`, `posthog`,
  `plausible` or `umami` across `apps/` and `docs/` returned zero matches in source — so where
  onboarding broke, whether invitations converted, and whether anyone used this as a *team* were
  all answered by intuition (audit finding PM-07). Two layers now exist, decided separately.
  **The funnel is instance-local and nothing about it ever leaves your server:** eleven steps
  (`user_registered`, `workspace_created`, `board_created`, `first_task_created`, `first_drag`,
  `invite_sent`, `smtp_configured`, `invite_accepted`, `dashboard_viewed`, `task_completed`,
  `wau_board_view`) plus a North Star — **Weekly Active Team Workspaces**, workspaces with 2+
  members where 2+ current members were active in the last seven days — computed on demand at
  `GET /instance/activation` and rendered at the bottom of Settings. Nine of the eleven are
  *derived* from `Activity`, `User` and `WorkspaceMember`, so the funnel covers an instance's
  whole history rather than starting flat at the deploy, and no new write path was added to any
  request that creates or moves anything. Every step counts distinct people, never events;
  `smtp_configured` is the one exception and sits between "invite sent" and "invite accepted"
  because without a mail transport an invitee cannot accept at all (ADR 0013), so a zero there
  explains a drop that would otherwise read as a product problem. Reading it requires the new
  `INSTANCE_ADMIN_EMAILS`, **blank by default, which means nobody** — including the account that
  owns every workspace on the box, because on an install with open registration "owner of a
  workspace" is a role any visitor can grant themselves. **Outbound telemetry is opt-in and off:**
  `TELEMETRY_ENABLED=false` is the default and sends nothing at all; switching it on *and*
  naming a `TELEMETRY_ENDPOINT` (no default — there is deliberately no built-in collector
  address) sends exactly one POST at process start carrying
  `{"event":"instance_started","version":"0.1.0"}` and nothing else — no instance identifier, no
  hostname, no IP, no counts, no part of the funnel, nothing about any person — logged in full
  before it is sent, never retried, and unable to delay or fail a boot. `docs/development.md`
  (EN + TR) lists the payload field by field; the reasoning, including why the ping carries no
  instance id and therefore counts starts rather than installs, is
  [ADR 0021](docs/decisions/0021-activation-funnel-and-opt-in-telemetry.md). Closes audit
  finding PM-07 ([#128](https://github.com/dravcore/kurultay/issues/128)).

- **Administrative actions now leave an audit trail.** `Activity` recorded only what happened to
  cards and comments, so board, column and label creation and deletion, workspace renames,
  member removals, role changes and the whole invitation lifecycle passed through the API
  without leaving a trace. After a compromised account or a bad departure there was no way to
  answer "who deleted that, and who gave them the role that let them" (audit finding SEC-05).
  Seventeen event types are now written — `board.*`, `column.*`, `label.*`, `workspace.updated`,
  `member.removed` / `member.left` / `member.role_changed`, `invitation.created` /
  `invitation.revoked` / `invitation.accepted` — each carrying the actor, the target, and both
  sides of every changed field, so a role change records the role that was held as well as the
  one that was granted, and a deleted board records the name and task count that stop existing
  with it. Deletions are written inside the transaction that performs them, before the delete,
  so a refused delete leaves no entry and a successful one cannot lose its record. No payload
  widens who can read something: the activity feed is readable by every member down to GUEST,
  while the pending-invitation list is admin-only, so `invitation.*` entries record the
  invitation id and role and never the invited address — an admin joins `WorkspaceInvitation`
  for that. `AUDIT_ACTIVITY_TYPES` in `@kurultay/shared-types` makes the whole question a single
  tenant-scoped query. Workspace *deletion* is the one act that cannot be stored this way —
  `Activity` cascades on `workspaceId`, so the row would delete itself — and is emitted on the
  JSON-line log instead, as a `workspace.deleted` event carrying the name, slug, member count
  and board count gathered before the delete.

- **Register form now shows field-level error messages** — when sign-up fails, the error is no
  longer reported as a generic "could not create your account" message. Better Auth error codes
  like `PASSWORD_TOO_SHORT` and `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` now map to their
  relevant field (password, email) with a message that tells the user exactly what to fix.
  Unknown errors fall back to the generic message to avoid leaking unnecessary details.
- **GHCR image publishing** — `.github/workflows/release-images.yml` builds and pushes
  `ghcr.io/dravcore/kurultay-api` and `ghcr.io/dravcore/kurultay-web` (`linux/amd64` +
  `linux/arm64`, tagged with the release's SemVer, its `major.minor`, and `latest`) on every
  `vX.Y.Z` tag push. `docker-compose.yml`'s `api`/`web` services now declare `image:
  ghcr.io/dravcore/kurultay-{api,web}:${TAG:-latest}` alongside their existing `build:`, so
  `docker compose pull && docker compose up -d` installs and upgrades from a published image
  with no local build — falling back to `build:` automatically (same source build as before)
  when no image exists for the configured `TAG` or the registry is unreachable. `TAG` is a new
  compose-only `.env` variable (see `.env.example`) for pinning a specific release instead of
  tracking `latest`. `migrate` (the one-shot migration runner) still always builds from source
  — see the comment beside it in `docker-compose.yml` for why that's scoped out of this change
  — and the published `web` image only has its `NEXT_PUBLIC_API_URL` set to the Dockerfile's
  `http://localhost:4000` default, since Next.js bakes `NEXT_PUBLIC_*` into the client bundle
  at build time; a deployment needing a different API origin still runs `docker compose build
  web` until the runtime-configurable API URL that follows this change lands. Closes audit
  finding OPS-04 ([#126](https://github.com/dravcore/kurultay/issues/126)); README (EN + TR)
  and `docs/development.md` (EN + TR) now document the pull-based flow as the default, with
  `docker compose up --build` kept as the explicit build-on-purpose path.
- `SEED_LARGE_BOARD_TASKS` — `pnpm db:seed` can now build a board of arbitrary size next to the
  four-task demo one (`SEED_LARGE_BOARD_TASKS=1000 pnpm db:seed`). Blank or `0`, the default,
  skips it, so the everyday seed is unchanged. The rows are deliberately uneven — five columns
  with the largest holding about a third of them, mixed priorities, labels on half the cards,
  assignees on a quarter, due dates spread across and past the due-soon window — because a
  board where every card is the same shape measures one shape of card. This is what the board
  render budget below was measured against. See
  [docs/development.md](docs/development.md#seeding-a-large-board).
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
- **The product now says when it cannot send email.** A deployment with no `SMTP_HOST`
  delivers nothing, so nobody can confirm an address and therefore nobody can accept an
  invitation — a deliberate security trade-off (ADR 0013, GHSA-fmh4-wcc4-5jm3) that the
  product used to keep entirely to itself: the admin sent an invitation, the API answered
  `201`, the message went to a log file, and the only visible outcome was an invitation nobody
  ever accepted. Two new signals close that. `GET /config` — a new instance capability
  document, session-required, deliberately not part of the liveness probe — reports
  `mailEnabled`, and Settings → Members turns `false` into a standing, non-dismissable notice
  that names the constraint, links to the SMTP setup guide, and points at the **Copy link**
  control that still works. `POST /workspaces/:workspaceId/invitations` now also reports
  `emailDelivery` (`SENT` / `NOT_CONFIGURED` / `FAILED`) for the invitation it just created,
  so an admin is told at the moment they send it rather than by a teammate who never got an
  email; the field is absent when no send was observed, which is deliberately not the same as
  `SENT`. Both values derive from the transport the mail module actually selected — nothing
  reads `SMTP_HOST` a second time — so the UI and the log can no longer disagree about the
  same deployment. Sending is still not a precondition of anything: the invitation is created
  either way.
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
- Observability baseline — until now a production failure or outage was only discovered when
  a user complained, and container logs grew without a ceiling until the disk filled. Three
  pieces close that, none of which is a metrics stack:
  - **Error tracking via Sentry, off by default.** With `SENTRY_DSN` (API) and
    `NEXT_PUBLIC_SENTRY_DSN` (web) blank — the shipped default — neither app loads the SDK at
    all: no initialization, no global handlers, no outbound connection, and no Sentry chunk
    requested by a visitor's browser. Turning it on is a deliberate, documented choice, and
    self-hosted Sentry works the same way. The API reports 5xx only (4xx client errors are
    noise, and are already in the access log), every event carries the request's `requestId`
    tag so a Sentry issue and a log line join with one grep, and `release`/`environment` are
    settable via `SENTRY_RELEASE`/`SENTRY_ENVIRONMENT`. `sendDefaultPii` is off and a
    `beforeSend` hook additionally strips cookie/authorization headers, cookies, request
    bodies, query strings, and everything on `user` except the opaque id. Performance tracing
    and Session Replay are pinned off and not exposed as settings. The web build plugin runs
    only when a DSN is configured and uploads source maps only when `SENTRY_AUTH_TOKEN` is
    also present, so a token-less build never fails.
  - **Log rotation on every compose service.** Docker's `json-file` driver is unbounded by
    default; every service in `docker-compose.yml` and `docker-compose.dev.yml` now caps at
    3 files × 10 MB via a shared `x-logging` anchor. This applies at container *creation*, so
    an existing deployment needs `docker compose up -d` (not a plain restart) to pick it up.
  - **An uptime-monitoring procedure** in `docs/development.md#observability`: which endpoint
    to poll (`/health/ready`, not `/health` — the liveness probe stays green while the
    database is down, by design), at what interval and threshold, and how to verify the alert
    actually fires. The monitor itself lives outside this repository, in a free external
    service.
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

- **The nightly retention sweep now covers a fifth table.** `UsagePing` — the deduplicated
  "somebody opened a board / the dashboard" rows the activation funnel above needed — is swept
  under the existing `ACTIVITY_RETENTION_DAYS` rather than growing a window of its own: it is
  the same class of row (instance history naming a user), and two settings on one class of data
  can only ever disagree with each other. `0` still means "keep forever" for both. The job's
  nightly JSON log line gains a `usagePings` count alongside the four it already carried; it is
  still counts only, with nothing from the rows themselves.

- **A board column now mounts 40 cards at a time instead of all of them**, revealing the next
  batch as the reader scrolls toward the end of the current one, and cards are marked
  `content-visibility: auto` so the mounted ones nobody is looking at cost no paint. Nothing
  about loading changed: every task page still drains into state, the column header still
  reports the column's true total, and the board still paints on the first page. What changed
  is how many of those rows exist as DOM at once — which is the number the cost of *dragging*
  scales with, because every mounted card is a dnd-kit sortable that re-runs on every pointer
  move. Measured on a seeded 1 000-task board (`SEED_LARGE_BOARD_TASKS=1000`, five columns,
  the largest holding 333), production build, drag driven at ~120 pointer moves per second for
  four seconds: the main thread went from **99.9% busy with 28 long tasks totalling 3.8 s** to
  **34.1% busy with none**, per processed pointer move from **84 ms to 2.6 ms**, DOM nodes from
  **18 421 to 3 854**, and heap after a drag from **117 MB to 19 MB**. Time to the board's first
  paint was already good and is unchanged (~130–165 ms, first page then stream). Dragging,
  keyboard reordering and drops all behave as before, including onto and out of columns whose
  tail is not mounted. `content-visibility` alone was measured too and is not a substitute: it
  halved the frame time and left the main thread saturated (audit finding FE-03,
  [#125](https://github.com/dravcore/kurultay/issues/125)).
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

### Removed

- Two never-used indexes: `Column_boardId_idx` and `Notification_userId_createdAt_idx`
  (audit finding DB-07). Both looked redundant on structural grounds — a strict prefix of an
  existing unique/composite index, or no matching application query — but the finding also
  called for verifying that against `pg_stat_user_indexes.idx_scan` on production-like volume
  before dropping anything, so all five originally flagged candidates were load-tested first.
  Three came back genuinely in use (`TaskAssignee_taskId_idx` and `TaskLabel_taskId_idx` back
  the task board's assignee/label loading and were kept because Postgres's planner
  consistently prefers the narrower index over the wider unique one for that lookup;
  `Activity_workspaceId_createdAt_idx` was kept because the dashboard's throughput query
  picked it over its three-column sibling often enough across repeated trials that "always
  subsumed" didn't hold) and are staying. Only the two with zero measured scans across three
  independent seeded trials were dropped. See
  `apps/api/prisma/migrations/20260814150000_drop_unused_indexes` for the full methodology.

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
- Switching workspaces twice in quick succession no longer risks landing on the wrong role.
  `onSwitch` used to write whichever `fetchOwnMembership` reply arrived last in wall time, not
  whichever switch was requested last, so a slow first response could overwrite the second
  workspace's role with the first workspace's — most visibly as a moment of ADMIN-only
  controls, and their `403` toasts, flashing inside a workspace where the user is only a
  VIEWER. Each call now stamps a generation counter before awaiting anything and only the
  call that still holds it when its reply lands is allowed to write `activeRole`, the same
  pattern `use-board-mutations.ts`'s `moveGenerationRef` uses to drop overtaken drag results.
- The sidebar's collapsed/expanded state survives a reload and no longer resets itself when
  the viewport crosses the 1280px breakpoint. Previously every `matchMedia` `change` event
  unconditionally reapplied the breakpoint's answer, silently reverting a click made while on
  the other side of it, and nothing was persisted, so every session started back at the
  breakpoint default regardless of what was chosen last time. The toggle now writes to
  `localStorage`, and the breakpoint listener defers to a stored preference instead of
  overwriting it.
- Two columns created or moved into the same gap on the same board at the same time can no
  longer land on the same `position`. `ColumnService.create` read its siblings outside any
  transaction and, when the gap did not need a rebalance, ran a single unguarded insert;
  `move` opened a transaction but never locked the board row inside it. Both now take the
  same `SELECT … FOR UPDATE` lock on the board row that `createDefaults` already took when
  seeding a new board's starting columns, and that the task create/move path already took on
  the column row — a concurrency contract the column path had simply never picked up. The
  observable symptom was never data loss (`(position, id)` keeps ordering deterministic even
  on a tie) — only two users seeing a different column order than either expected.

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
- Every service in `docker-compose.yml` and `docker-compose.dev.yml` now runs with the full
  Linux capability set dropped (`cap_drop: [ALL]`) and `no-new-privileges:true` set — the
  capability half of SEC-02 that PR #109's `USER node` left open. `api`, `web`, `migrate`,
  and `backup` need nothing added back; `postgres` gets `CHOWN`/`FOWNER`/`SETUID`/`SETGID`/
  `DAC_OVERRIDE` back (its official entrypoint `chown`s `PGDATA` and re-execs via `gosu` on
  every boot); `redis` gets `SETUID`/`SETGID` back so its own entrypoint can drop privilege
  to the `redis` user via `setpriv` (see the next entry for why that path was broken before
  this PR). See [development.md#container-hardening](docs/development.md#container-hardening)
  for the full per-service reasoning.
- **Fixed:** the `redis` service ran as root for its entire life, not the `redis` user the
  image ships. `REDIS_PASSWORD` becoming optional (below) wrapped the container's command in
  `sh -c 'if [ -n "$REDIS_PASSWORD" ]; then …; fi'`, which handed the official image's
  entrypoint `sh` as its first argument instead of `redis-server` — exactly what the
  entrypoint's own privilege-drop check keys on, so the drop silently never ran. This was
  real on `develop` between that change and this one, not merely theoretical: `docker top`
  (not `docker exec ... id`, which reports the exec session's own user rather than PID 1's)
  showed `redis-server` owned by `root`. Fixed by switching `command:` to exec form —
  `['redis-server', '--requirepass', '${REDIS_PASSWORD:-}']`, substituted by Compose itself
  — so the entrypoint sees `redis-server` again and drops privilege as designed; verified
  with `docker top` showing uid 999 and a `SET`-then-restart cycle surviving intact in both
  the password and no-password cases.

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
