# Changelog

All notable changes to Kurultay are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Task attachments — files and links on a card.** A task now carries attachments of two
  kinds, and the schema says which: a `FILE` has stored bytes, a sniffed media type and a size;
  a `LINK` has only a URL. Both are first-class user features, not one plus an import artifact
  ([ADR 0022](docs/decisions/0022-attachment-storage.md),
  [ADR 0024](docs/decisions/0024-attachment-kinds-and-serving-policy.md)). The task panel
  uploads a file, attaches a link, lists what is there newest-first, previews the four image
  types inline and removes an attachment; the board card gains a count badge and renders
  nothing at all on a task with no attachments. Five endpoints were added under the workspace
  root, one of which — the byte stream — is the first response in this API that is not JSON.
  No new socket event: an attachment change emits the same `task:updated` every other task
  sub-resource uses, and the client re-reads over REST.

  **The server never requests a `LINK`'s URL.** No preview, no favicon, no `<title>` scrape,
  no unfurl, no health check — the URL is opaque text that is stored, returned and rendered by
  the client. Only `http:` and `https:` are accepted at write time. A server-side fetch of a
  user-supplied URL is an SSRF primitive, and a Compose network where `postgres` and `redis`
  resolve by name is the worst place to have one; link previews are cosmetic, the capability
  they require is not.

  **Files are accepted on their magic bytes, not their extension or their declared type.** The
  allowlist is broad — PNG/JPEG/GIF/WebP, PDF, the OpenXML and OpenDocument office formats,
  ZIP, `text/plain` and `text/csv` — and excludes `text/html` and `image/svg+xml` by name,
  because images are the one family served `inline` and both of those are markup. Plain text
  has no magic number, so `.txt` and `.csv` come in through a deliberately narrow fallback:
  the declared type must be exactly one of those two, the bytes must decode as UTF-8, contain
  no `NUL`, and not begin with `<`. Anything else is a `415`. Downloads always carry the
  sniffed type, `nosniff`, `Cross-Origin-Resource-Policy: same-origin` and a `private,
  must-revalidate` cache policy; everything except the four image types is served
  `Content-Disposition: attachment`, PDFs included.

  **Operators: three things change.** First, **the API becomes stateful** — a new
  `attachment_data` volume holds the uploaded files, the `backup` sidecar now writes **two**
  archives per cycle (the `pg_dump` and a `-files.tar.gz` sharing its timestamp), and the
  restore procedure grew a step: restoring the dump without the matching file archive brings
  the rows back and leaves every file behind, which passes every check written before
  attachments existed. The rehearsed drill in
  [development.md](docs/development.md#restoring-from-a-backup) now compares file count **and**
  per-file size against the rows. Second, **the reverse-proxy contract gains a body-size row,
  and its number is deliberately not the same as the user-facing limit**:
  `ATTACHMENT_MAX_BYTES` is `26214400` (25 MiB) and is the size of the _file_, while the proxy
  caps the _whole request body_ at 26 MiB, because a multipart envelope adds a few hundred
  bytes on top — set both to 25 MiB and a file of exactly the documented limit becomes
  unuploadable. The rule between them is an ordering, not an equality: the proxy must never
  reject what the API would accept. A replacement proxy that omits the row rejects everything
  over nginx's 1 MB default. Third, **the nightly retention sweep now also unlinks stored files
  no attachment row claims**, after a grace period of `BACKUP_KEEP × BACKUP_INTERVAL` (floored
  at 24 hours) — which is why those two variables are now passed to the `api` service as well
  as to `backup`. Attachments are off entirely unless `STORAGE_PATH` is set; links work either
  way, and `GET /config` reports `attachmentsEnabled` so the UI can say so.

  **One audit-query note.** `AUDIT_ACTIVITY_TYPES` grew by one entry, `attachment.deleted`, so
  the administrative activity query returns a type it did not before — on the singular path
  only, one person detaching one file. `attachment.created` was deliberately left **out** of
  that subset: the Trello importer will write one attachment row per imported URL, which is
  the bulk-volume behaviour the audit list excludes `comment.created` for. The upload is still
  on the task's own activity feed either way.

- **Task checklists.** A task can now carry multiple named checklists, each with its own items
  — the shape Trello uses, chosen because Trello import (P3-3, the next roadmap item) targets a
  source that is itself multi-list, and because a single flat list would need re-modelling the
  moment that importer landed ([ADR 0023](docs/decisions/0023-checklist-data-model.md)). The
  task panel adds and removes checklists, adds and removes items, and ticks items off; the
  board card shows a `done/total` badge and renders nothing at all on a task with no checklist.
  Completion is counted at read time from whichever items are loaded — never stored on the task
  — so a board badge can't drift out of sync with the items it summarizes. No new socket event
  was added: a checklist or item change calls the same `TaskEventsService.emitUpdated` every
  other task sub-resource already uses, so `task:updated` plus a REST re-read carries it, the
  same way label changes do. `Checklist.position` and `ChecklistItem.position` follow every
  other position field in the schema — `Float`, fractional-indexed — and the API exposes a move
  endpoint for each, but **the panel does not yet offer drag-and-drop reordering for checklists
  or items**; only creation, deletion and toggling are wired up on the client. Subtasks — a
  task-shaped child with its own board column, position and assignee — remain out of scope:
  ADR 0023 treats that as a different data model from a checklist item, not a deeper one.

- **Trello board import, one-way.** A workspace admin uploads a Trello board's JSON export at
  `POST /workspaces/:workspaceId/imports/trello` and gets a new board: lists become columns,
  cards become tasks, labels fold onto the eight design-token colour slots, and Trello's
  checklists arrive as checklists — one Kurultay list per Trello list, unflattened, which is the
  shape [ADR 0023](docs/decisions/0023-checklist-data-model.md) chose in advance for exactly this
  ([ADR 0025](docs/decisions/0025-trello-import-mapping.md)). The board list gains an "Import from
  Trello" entry; the report comes back in the response and is rendered as a panel that stays until
  it is dismissed.

  **It is not idempotent, and that is a decision rather than a gap.** Importing the same export
  twice creates **two boards** — there is no dedupe key, no update-in-place and no "already
  imported" answer, because updating an existing board is synchronisation rather than import and
  needs a conflict policy, a deletion policy and a direction. The dialog says so before the upload
  and a test pins the behaviour, so anyone who adds deduplication has to read the record first.

  **Four things deliberately do not come across, and the report counts every one of them rather
  than dropping them silently.** *Files*: a Trello export carries attachment URLs, not bytes, so
  every attachment becomes a `LINK` row — and the server never requests those URLs, the same SSRF
  rule the attachment feature already follows. *Members*: a Trello account is not a Kurultay
  account, so assignments are dropped and every row written — tasks and attachments alike — is
  attributed to the person who ran the import. *Comments*: out of scope for this pass. *Archived
  lists and cards*: Kurultay has no archive, and importing what a user deliberately filed away
  would be the wrong default. Alongside them the report also carries what came across *changed*:
  **every imported column arrives `UNSTARTED`**, because [ADR 0019](docs/decisions/0019-column-category.md)
  refuses to infer completion from a column's name or its position and a Trello list carries
  neither — so the panel says how many columns are waiting and links to where they are set. On an
  imported board no column means "done" until someone says so, which means the dashboard's
  completion figures read zero until then.

  **The write is atomic; the coverage is partial.** Reading and mapping happen in two pure
  functions before the transaction opens, so a malformed export costs a `400` and writes nothing —
  there is no half-imported board, and no "skip this one and carry on" inside the transaction. The
  report is the body of the `201` and **is not stored anywhere**: no `ImportRun` table, no status
  endpoint, no way to ask for it again. Dismissing the panel is permanent; the board is unaffected.
  One activity row is written per import (`board.imported`, new in `AUDIT_ACTIVITY_TYPES`), not one
  per card, and no socket event is emitted at all — a new board's room has nobody in it yet.

  **Operators: one new variable.** `TRELLO_IMPORT_MAX_BYTES` (default `20971520`, 20 MiB) is the
  largest export the importer will accept. It is a **memory** ceiling rather than a disk one — the
  body is buffered and `JSON.parse`d and the parsed graph is a multiple of the bytes — which is why
  it is a separate number from `ATTACHMENT_MAX_BYTES` and not derived from it, and why raising it
  raises peak heap by a multiple of the change. It must stay below the reverse proxy's body limit;
  `two-layer-limit.spec.ts` fails the build if it stops doing so. Import needs no `STORAGE_PATH`:
  it stores no bytes. The endpoint is admin-only (creating columns is, so creating a board *and*
  its columns in one request is too) and rate-limited to **3 requests a minute**, well under the
  upload budget because one request costs a 20 MiB parse plus the longest-lived write transaction
  in this API.

  **What was measured, and what was not.** A generated 500-card export imported in a **median of
  572.9 ms and a p95 of 655.8 ms** over five runs on an Apple M3 Max, against a local API and
  Postgres over loopback — no reverse proxy, no container, no network between the client and the
  API. That is comfortably inside the two-minute budget the roadmap asked for, but it is a floor
  rather than a prediction for a real deployment. Schema conformance is the part that was **not**
  measured: no real Trello export was available, so every fixture is synthetic and nothing here is
  evidence about Trello's actual export format, whose schema has no version field and no
  changelog. The reader is written for that — an unrecognised field is counted into the report
  instead of failing the import — but the first genuine export remains the most likely place for
  it to break.

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
- **Browser end-to-end suite (Playwright)** — a new repository-level `e2e/` package runs four
  scenarios against a real Chromium, a compiled API and a production web build: sign in → open
  a board → drag a card → **reload and find it still moved**; a move made in one browser
  appearing in a **second browser** with no reload; an invitation sent from the settings dialog
  → read out of **Mailpit** → accepted from the link in the message; and clicking a
  notification opening **the task it refers to**. These four were the largest single gap in the
  project's testing: the unit suites and the API integration suite all pass against a board
  that never renders, and until now nothing exercised drag-and-drop, Socket.io, mail delivery
  or notification navigation in a browser at all. Two more scenarios arrived later in this same
  release, each with the feature it covers — an attachment uploaded and downloaded back, and a
  Trello export imported from a real file picker — bringing the suite to **six**. Scope is capped
  on purpose and the run is capped at five minutes by `globalTimeout` — this suite exists to notice
  when the *stack* comes apart, not to re-check the layers below it. Setup is done over HTTP and only the
  behaviour under test is clicked; there are no `data-testid` attributes (columns are
  `<section aria-label>`, cards carry `aria-label="Reorder <title>"` on their grip), no fixed
  waits, and no retries — including in CI. Each of the original four was verified by breaking the
  thing it protects and confirming it goes red; the two added since carry the same guarantee in a
  cheaper form, asserting the absence before the presence in every case. It runs in its own workflow
  (`.github/workflows/e2e.yml`) nightly and on pull requests into `main` — i.e. before every
  release and hotfix — deliberately **outside** the required `ci-ok` gate, so an infrastructure
  hiccup in a full-stack browser run can never block every merge in the repository. The suite
  isolates itself completely: ports 3110/4110, database `kurultay_test_playwright`, no Redis at
  all, and no new environment variables (the Postgres connection is derived from `DATABASE_URL`
  with only the database name swapped). A Redis logical database index was the obvious boundary
  and does not hold — `parseRedisUrl` drops the URL's pathname, so `redis://…/8` reaches database
  0 ([#190](https://github.com/dravcore/kurultay/issues/190)) — so the suite runs the API with no
  Redis, which it supports, and which is the only option here that is isolated rather than merely
  documented as such. Run
  it with `pnpm test:browser`. Closes audit finding QA-01
  ([#129](https://github.com/dravcore/kurultay/issues/129)); `docs/testing.md` (EN + TR) now
  names these flows as the concrete definition of the "critical flows later" it had been
  reserving Playwright for.
- **One image, any domain — and a one-page guide for putting it on yours.** The published
  `web` image no longer has a deployment's API URL compiled into it, so
  `docker compose pull && docker compose up -d` now works on `kurultay.example.com` exactly as
  it does on `localhost`, with no rebuild. Verified by running two independent stacks from the
  same image ID side by side on two hostnames — sign-up, email verification, boards and the
  realtime WebSocket all working on both. Closes audit finding PM-02
  ([#119](https://github.com/dravcore/kurultay/issues/119)).
  - `docker-compose.yml` gains a **`proxy` service (Caddy)** that is now the stack's only
    published entrance. It serves the web app and the API from one origin — `/auth/*` and
    `/api/*` to `api`, everything else to `web` — with automatic HTTPS once a domain is set.
    Its routing contract, and why the two API rules differ, is documented in `docker/Caddyfile`
    for anyone replacing it with their own proxy.
  - **`SITE_URL`** is the new (compose-only) `.env` variable for that origin, scheme included:
    `http://localhost` by default, `https://kurultay.example.com` to go live. The API's
    `WEB_URL` and `BETTER_AUTH_URL` are derived from it, so app, API and cookies agree on one
    origin without three variables to keep in sync.
  - **New guide: `docs/self-hosting.md`** (EN + TR) — DNS, HTTPS, SMTP, backups, upgrades,
    bring-your-own-reverse-proxy and troubleshooting, on one page.
- **`INTERNAL_API_URL`** — the absolute API address the web *server* uses for its auth
  middleware and server-side rendering, since a same-origin `/api` has no origin to resolve
  against inside Node. Unlike `NEXT_PUBLIC_*` it is read at container start, and
  `docker-compose.yml` points it straight at `http://api:4000` over the container network, so a
  server render never leaves the compose network.

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
  — see the comment beside it in `docker-compose.yml` for why that's scoped out of this change.
  Closes audit finding OPS-04 ([#126](https://github.com/dravcore/kurultay/issues/126)); README (EN + TR)
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

- **The two API images lost 2.8 GB between them, without dropping a dependency the app uses.**
  Summing `docker history` on `linux/arm64`: the `api` runtime image went from 955 MB to
  407 MB, and the one-shot `migrate` image from 2663 MB to 418 MB (audit finding OPS-07). As
  unpacked bytes on disk, the same two images went from 1.22 GB to 516 MB and from 3.37 GB to
  538 MB; compressed, from 266 MB to 108 MB and from 705 MB to 120 MB. All three readings are
  in `docs/development.md`, because they are far enough apart that quoting one alone would be
  choosing a flattering number.

  Most of the API image was never reachable code. `pnpm deploy --prod` prunes the deployed
  package's own `devDependencies` but keeps _optional peer dependencies_ — peers the publishing
  package itself marked `"optional": true`, which pnpm's `auto-install-peers` had resolved
  anyway. `better-auth` declares those on `next`, `react`, `react-dom`, `svelte`, `vue`,
  `solid-js`, `drizzle-orm`, `mongodb`, `mysql2`, `better-sqlite3` and `vitest`;
  `@prisma/client` declares them on `prisma` and `typescript`. Following those edges shipped
  `@next/swc-linux-arm64-{gnu,musl}` (169 MB), `@prisma/studio-core`, `@electric-sql/pglite`,
  `@prisma/engines`, `sharp`'s libvips builds, Playwright, `vite`, `rollup`, `esbuild` and the
  TypeScript compiler into an image whose only job is to run `node dist/main.js`.
  `scripts/prune-deployed-modules.mjs` now removes them: it walks `dependencies`,
  `optionalDependencies` and non-optional `peerDependencies` from the deploy's top level and
  deletes every virtual-store entry the closure does not contain. In pnpm's isolated layout
  those entries are off the primary resolution path, so this is not a judgement about which code
  "probably" runs — 269 of 493 store entries went, and 212 MB of `node_modules` remained.

  The residual risk, named in the script's header rather than left for someone to discover: a
  package that `require`s something it never declared used to resolve through pnpm's flat
  `.pnpm/node_modules` hoist, and no longer will. A manifest-only walk cannot see that, and it
  fails at runtime rather than at build. The mitigation is empirical — the healthcheck, the e2e
  suite, and a boot with the three opt-in paths that load code no default boot touches:
  `SENTRY_DSN` set (SDK initialises with 44 integrations, `flush()` returns), `SMTP_HOST` set
  (a real invitation arrives in Mailpit over SMTP), and `REDIS_URL` set (BullMQ schedulers and
  the Socket.io Redis adapter both register). All three were exercised against the pruned image.

  `migrate` was the bigger number and the simpler fix: the stage was `FROM build`, so the
  image was the entire assembled workspace — every dev dependency of every package, the
  sources, and pnpm — kept alive to run one command. It now starts from the same clean
  `node:24-alpine` the API does and carries the Prisma CLI, `prisma.config.ts`, the schema and
  the migrations. It also drops root: the old stage ran as root only because it inherited no
  `USER` from `build`, and `prisma migrate deploy` never needed one. Both images run as
  `USER node`, as before for `api` and newly so for `migrate`.

  Nothing about the compose contract moved: `docker compose up -d` still brings the stack up
  with `migrate` at `Exited (0)` and `api` `(healthy)`, `/health/ready` answers 200 through the
  proxy, and the web image is untouched — no build-time API URL was reintroduced.
- **"`develop` is always deployable to staging" is gone, replaced by a claim something checks.**
  `docs/git-strategy.md` had promised that since the branch table was written, and no staging
  environment has ever existed — no host, no workflow, no secret in this repository points at
  one (audit finding OPS-08). A standing promise nothing enforces is worse than no promise,
  because it is quoted as though it were a safety net. The table now says `develop` must
  **start**, which is verifiable, and the release process gained the verification as part of
  step 4: `docker compose up -d --build`, `docker compose ps -a`, `curl` the readiness endpoint,
  `docker compose down -v`. It is deliberately a release-time step rather than a CI job — a full
  compose boot on every pull request costs more than it catches — and it runs the same stack a
  self-hoster runs, `SITE_URL` at its `http://localhost` default, so what is checked is the real
  deployment shape and not a staging-only approximation. Step numbering is unchanged; the boot
  and the release PR share step 4.
- **`docs/self-hosting.md` now covers the host, not just the stack.** The guide arrived with
  automatic HTTPS but said nothing about what the machine around it should allow: it now states
  the inbound firewall rule (SSH, 80, 443 and nothing else), why the rest of the stack is
  already private without one (`proxy` is the only service in `docker-compose.yml` with a
  `ports:` entry — everything else is on Docker's internal network, checkable with
  `docker compose ps`), and the trap that makes a firewall alone insufficient on Linux: Docker
  publishes ports through its own iptables rules, which are consulted before ufw's, so a port
  published in an override is internet-facing despite a `ufw deny` covering it. Verifying the
  deployment also no longer stops at "the page loads" — step 4 checks the thing HTTPS was for,
  by reading the session cookie back. `SITE_URL=https://…` yields
  `__Secure-better-auth.session_token=…; HttpOnly; Secure; SameSite=Lax`; the same request under
  `SITE_URL=http://…` yields `better-auth.session_token=…; HttpOnly; SameSite=Lax`, no prefix
  and no `Secure`, with the session token crossing the network in clear text. Both measured on a
  running stack. Better Auth derives both properties from the scheme of the URL it is configured
  with, which makes the scheme in `SITE_URL` the single switch behind them — now stated where an
  operator will read it, along with what the wrong answer looks like.
- **The nightly retention sweep now covers a fifth table.** `UsagePing` — the deduplicated
  "somebody opened a board / the dashboard" rows the activation funnel above needed — is swept
  under the existing `ACTIVITY_RETENTION_DAYS` rather than growing a window of its own: it is
  the same class of row (instance history naming a user), and two settings on one class of data
  can only ever disagree with each other. `0` still means "keep forever" for both. The job's
  nightly JSON log line gains a `usagePings` count alongside the four it already carried; it is
  still counts only, with nothing from the rows themselves.
- **`api` and `web` no longer publish host ports in `docker-compose.yml`.** Both are reached
  through the new `proxy` service on port 80/443, so a Docker install is now at
  `http://localhost`, not `http://localhost:3000`. This closes a real gap rather than just
  tidying: with no route around the proxy, the API's `TRUST_PROXY` can be fixed at `1` (it is),
  which restores the per-client rate-limit buckets and access-log IPs that would otherwise have
  collapsed onto the proxy's own container address. `docker-compose.dev.yml` and the `pnpm dev`
  loop are unchanged — they still run the two apps on `:3000`/`:4000` as separate origins.
- **The `web` image bakes `NEXT_PUBLIC_API_URL=/api`** instead of `http://localhost:4000`, and
  the variable was removed from `docker-compose.yml`'s build `args:` so a local
  `docker compose build web` produces the same bundle as the release image rather than baking
  whatever the dev loop left in `.env`. Next.js still inlines `NEXT_PUBLIC_*` at build time —
  that cannot change — but the value being inlined is now correct on every domain. A deployment
  that wants the API on its own hostname can still build with
  `--build-arg NEXT_PUBLIC_API_URL=https://api.example.com` and accept a domain-specific image.
- The web app's CSP `connect-src` collapses to `'self'` for a same-origin API instead of naming
  an origin and a derived `ws(s)://` one. `'self'` covers the same-origin WebSocket upgrade
  (CSP Level 3), confirmed in a browser against the real stack rather than taken from the
  spec — had it not, Socket.io would have quietly fallen back to its polling transport.

  **Upgrading an existing Docker install:** set `SITE_URL` in `.env` (`http://localhost` keeps
  today's behaviour, on the standard port), then `docker compose pull && docker compose up -d`.
  `WEB_URL` and `BETTER_AUTH_URL` in `.env` no longer affect the compose stack — they belong to
  the dev loop now — so a deployment that set them must move that value to `SITE_URL`. If port
  80 is taken on your host, override `proxy`'s `ports:` rather than re-publishing `web`'s.

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

- **An oversized JSON body answered `500` and was filed in Sentry as a server fault.** Express's
  body parsers signal every rejection by throwing an
  [`http-errors`](https://github.com/jshttp/http-errors) instance — a plain `Error` subclass
  carrying `status: 413`, not a Nest `HttpException` — so it matched only the
  `AllExceptionsFilter` fallback for an unrecognised error, and every request that sent too much
  data became an "unexpected server failure" in the error envelope *and* an event on a
  self-hoster's error-tracking quota. It is now `413 Payload Too Large` in the same envelope,
  with wording this project chose rather than the library's, and it is not reported: a client
  sending too much data is the API working as designed, exactly like a `404` or a `403`. The
  branch is deliberately narrow — it requires the full shape `http-errors` uses to identify its
  own errors (a real `Error`, a boolean `expose`, and `status === statusCode`) and it stops at
  4xx, so a library that merely records an upstream's status code cannot have its failure
  relabelled as a client error and disappear from error tracking. A malformed JSON body was
  never part of this: Nest converts any `SyntaxError` to a `400` before a filter sees it, and it
  is now pinned by a test that says so.

- **The request body limit was Express's unconfigured default, not a decision.** Nothing in this
  repository set one, so the API's real ceiling was body-parser's built-in **100 kB** — a value
  nobody chose and no file recorded, discoverable only by sending a large body and watching what
  came back. The limit is now explicit and named: `REQUEST_BODY_MAX_BYTES`, default `1048576`
  (1 MiB), documented in `.env.example` and
  [api-conventions.md](docs/api-conventions.md#request-body-size), applied to the JSON *and* the
  form-encoded parser. 1 MiB is about two orders of magnitude above the largest body any endpoint
  legitimately receives today (no array bodies; the longest single field any DTO accepts is 2048
  characters), and it is a memory ceiling as much as a size one — the body is parsed into heap
  before anything validates it. It has nothing to do with `ATTACHMENT_MAX_BYTES`: an upload is
  `multipart/form-data`, which these parsers never see.

- **`REDIS_URL`'s database index was accepted and then quietly ignored.** Every ioredis and
  BullMQ connection in the API is built by one function, `parseRedisUrl`, and it returned only
  `{ host, port, password }` — the URL's path segment (`redis://redis:6379/3`) and any `?db=`
  went nowhere. An operator who points several apps at one Redis and separates them by index —
  which is what the index is for — got database 0 anyway, with no warning and no error, on top
  of whatever was already living there. Redis `SELECT` is per connection, so it could not be
  corrected from outside the process either. The index is now carried through to every consumer:
  auth rate-limit counters, both BullMQ queues (`due-soon`, `cleanup`) and the Socket.io
  adapter's pair of clients. An index that is not a plain non-negative integer, or a path and a
  `?db=` that disagree, now fails loudly at connection time instead of being coerced to 0 — a
  typo in the one setting that exists to keep two apps apart must not silently put them
  together. **The separation an index buys is a keyspace, not a channel:** Redis pub/sub is not
  scoped by database, so two instances on different indexes still share the Socket.io fan-out
  channel while their queues and counters no longer collide (measured, and now asserted in
  `apps/api/test/redis-database-index.e2e-spec.ts`, which connects on index 3 and asks the
  server — `CLIENT LIST`, plus observer clients on 3 and 0 — where each connection and key
  actually landed, rather than asserting what the parser returned).
  Closes [#190](https://github.com/dravcore/kurultay/issues/190).
- **The uptime monitor the docs tell you to build was pointed at a URL that is not the API.**
  `docs/development.md` said to monitor `https://<your-host>/health/ready`, which predates the
  reverse proxy: behind `proxy` that path matches the catch-all rule, reaches the web app and
  answers `307` with a redirect to `/login`. Followed together with the same section's "expected
  status: 200", it produces a monitor that is red on a perfectly healthy instance — and the
  obvious way to quiet it, widening the accepted statuses, produces one that is green during an
  outage instead. Measured on a running stack: `/health/ready` → `307`, `/api/health/ready` →
  `200 {"status":"ok","checks":{"database":"up","redis":"up"}}`. The path is corrected, the
  reason it is easy to get wrong is written down next to it, and the push-model cron beside it —
  which probed `localhost:4000`, a port no Docker deployment publishes any more — now goes
  through `docker compose exec` instead. `docs/self-hosting.md` gained the monitoring step
  itself, as step 5 of the deployment rather than a footnote, including the deliberate outage
  drill (`docker compose stop postgres` → `503` naming `"database":"down"`, `start` → `200`,
  both verified) that turns an alerting setup from a hypothesis into a safeguard.
- `docs/self-hosting.md` now explains the failure every reader hits before the first release
  that publishes images. `docker compose pull` exits non-zero with `denied` for `api` and `web`
  — the workflow that pushes them runs on a release tag, and `v0.1.0` predates it — after
  succeeding for `postgres`, `redis` and `caddy`, so the three that worked scroll the two that
  did not off the screen. The same is true of the files step 2 downloads: they come from `main`,
  which carries only what the newest release carried, so a reader can end up with a
  `docker-compose.yml` that has no `proxy:` service and no `docker/Caddyfile` to fetch beside
  it — at which point none of the guide's HTTPS applies to what they just downloaded. Both are
  named in Troubleshooting, with the build-from-source path that works in the meantime.
- `docs/self-hosting.md` told operators to look for `migrate` in `docker compose ps` output and
  expect it to say "exited". A plain `ps` lists running containers only, so the one-shot
  `migrate` row it names is the one row that is never there. Corrected to `ps -a`, with the
  expected output printed in full so "healthy" is recognizable rather than guessed at —
  including why `backup` and `proxy` show no `(healthy)` marker (neither declares a
  healthcheck), which otherwise reads as two broken services.
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
- The due-soon scan no longer gives up for a full 15-minute tick on a single failed run.
  `DueSoonWorker`'s scheduler asked BullMQ for the queue defaults — one attempt, no backoff —
  so a run that landed on a momentary Postgres or Redis blip simply waited for the next
  scheduled tick instead of retrying inside the same one. It now gets three attempts with an
  exponential backoff (30s, then 60s), so a transient blip is absorbed in under two minutes
  instead of up to fifteen. The `failed` handler used to log every failure at `error` whether
  or not BullMQ was about to retry it; a mid-retry failure is now `warn`-level noise, and only
  the final failure — every configured attempt spent, nothing left to retry it — logs at
  `error` and is reported through `captureServerError` (opt-in Sentry, `docs/development.md`),
  since `removeOnFail: 50` alone only helps someone who already knew to go looking. Closes
  audit finding BE-06 ([#148](https://github.com/dravcore/kurultay/issues/148)).

### Security

- **Release images are signed, ship an SBOM, and are built by workflows whose every action is
  pinned to a commit.** Three parts of audit finding SEC-06
  ([#157](https://github.com/dravcore/kurultay/issues/157)), all of them things a self-hoster
  can now check rather than take on trust. Every `uses:` across the five workflow files moved
  from a mutable major tag (`@v7`, `@v3`) to a full commit SHA with the release in a same-line
  comment — a major tag is a pointer its owner can move, so an action compromised upstream
  reached this repository's runners on the next push with no diff for anyone to review. Each
  published image is then signed with cosign, keylessly: no long-lived key exists to be
  leaked, and the certificate binds the signature to this repository's release workflow at the
  release's git ref, which is what makes `cosign verify` say something a stranger can rely on.
  An SBOM (SPDX 2.3 JSON, from syft) is generated per image **per architecture** — amd64 and
  arm64 do not contain the same packages, so one file for both would have been quietly wrong
  for every ARM operator — and attached to the GitHub Release as an asset. The verification
  commands, with this repository's exact identity and issuer, are in
  [docs/self-hosting.md](docs/self-hosting.md#verifying-what-you-pulled); an unchecked
  signature protects nobody.
- **`TAG=vX.Y.Z` now resolves to a published image.** Every place in this repository that tells
  an operator how to pin a release — both READMEs, both self-hosting guides, `docs/development.md`
  three times, and the comment beside `image:` in `docker-compose.yml` — says `TAG=vX.Y.Z`, but
  the release workflow published `0.2.0`, `0.2` and `latest` and never `v0.2.0`, because
  `docker/metadata-action`'s `{{version}}` strips the `v`. Following the documented instruction
  could only ever end in a failed `docker compose pull`. The workflow now publishes the
  `v`-prefixed tag as well. Found while writing the `cosign verify` command, which needs an
  image reference that exists.
- **An attachment's display name can no longer be made to render as a different name.** The
  Unicode bidi overrides (U+200E/U+200F, U+061C, U+202A–U+202E, U+2066–U+2069) and the C0/C1
  control characters are now stripped from a stored filename at write time, and again when that
  name is written into `Content-Disposition`. U+202E reverses the rendering of everything after
  it, so a file uploaded as `invoice<RLO>gnp.exe` was shown — in the task panel and in the
  browser's own save prompt — as `invoiceexe.png`. Measured surviving the whole path before the
  fix: the RFC 5987 `filename*` parameter percent-encodes the character and the browser decodes
  it again, so neither half of the header caught it, and the ASCII `filename=` half looked clean
  either way. The same cleaning now also applies to a `LINK`’s label, which went through none
  at all — it never reaches a header, but it reaches the same panel. Ordinary non-ASCII names are
  unaffected and a control test says so.
- **The byte-stream endpoint’s tenant guard is now covered by a test.** `@WorkspaceScoped()` on
  `GET /workspaces/:workspaceId/attachments/:id/content` could be deleted with the entire API
  suite — 1064 unit tests and 34 integration tests — still green: every tenant-scope test put the
  requester's *own* workspace id in the path, which exercises the service's `where` clause and
  not the guard. The uncovered case is the one that matters more: a signed-in non-member writing
  the *owning* workspace's id into the path is asking for a row that really does live there, so
  the `where` clause matches and only the guard stands in the way. Two integration tests now
  cover it — a user who belongs to no workspace, and a user who belongs to a different one.
- **A cross-origin upload is now proven not to buffer the body before it is rejected.** The
  origin allowlist covers `POST` and therefore covers uploads, and an existing test showed the
  handler never runs — but multer buffers the whole part before the handler either way, so that
  was one step short of the property the megabyte-sized limits depend on. A test with a
  disk-backed multer now measures the destination directory staying empty, with an allowed-origin
  control that shows the same request really does write a file there.
- **State-changing requests are now checked against an origin allowlist, server-side.** Until
  now every CSRF defence the API had lived in the browser: a `SameSite=Lax` session cookie and
  a single-origin CORS allowlist. Server-side there was nothing, and that was measurable — a
  `POST /workspaces` carrying a valid session cookie and `Origin: https://evil.example` was
  answered `201` with a created workspace, and so was the same request form-encoded, which is
  the case that matters most: `application/x-www-form-urlencoded` makes a cross-site POST a
  *simple request*, so no preflight is sent and CORS never gets to decide anything at all. For
  the single most CSRF-prone request shape there were zero layers, not one. `POST`, `PUT`,
  `PATCH` and `DELETE` are now refused with `403` when they announce an origin — in `Origin`,
  or in `Referer` when `Origin` is absent — outside the allowlist, which is derived from the
  same `WEB_URL` that configures CORS so the two can never drift apart. `Origin: null`, what a
  sandboxed document sends, is not on the list. A request announcing no origin at all still
  passes: browsers must send `Origin` on every non-`GET`/`HEAD` request, so no cross-site shape
  both carries a victim's cookie and omits it, and refusing the header-less case would break
  `curl`, CI, native clients and the web app's own server-side session lookup while closing
  nothing. Implemented as Express middleware rather than a Nest guard because `/auth/*` bypasses
  the Nest router (ADR 0004) and needed the check just as much — Better Auth's `originCheck`
  guards redirect targets, not credential endpoints, and cross-site `POST /auth/sign-in/email`
  and `POST /auth/sign-out` were both measured answering `200`. Better Auth's own check is left
  intact underneath. Reads are untouched and still governed by CORS. Serving the app and the API
  from one origin (`docker/Caddyfile`) keeps the cookie `SameSite=Lax` and remains the
  recommended deployment; this is the layer that survives the deployments that leave that path,
  where the cookie has to be `SameSite=None` and `SameSite` protects nothing. Operator
  consequence: `WEB_URL` must be the exact origin the browser loads the app from — any spelling
  of it (trailing slash, path, explicit `:443`) works, a non-URL now fails the process at start.
  See [api-conventions.md](docs/api-conventions.md#cross-origin-requests). Closes audit finding
  SEC-04.
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
