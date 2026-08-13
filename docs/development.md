# Development

How to set up a Kurultay development environment and work in it day to day.

> 🌐 English (canonical) | [Türkçe](tr/development.md)

## Contents

- [Status](#status)
- [Prerequisites](#prerequisites)
- [Clone and install](#clone-and-install)
- [Environment variables](#environment-variables)
- [Database and cache credentials](#database-and-cache-credentials)
- [Database connection pool](#database-connection-pool)
- [SMTP and Mailpit](#smtp-and-mailpit)
- [Run modes](#run-modes)
- [pnpm scripts](#pnpm-scripts)
- [Database workflow](#database-workflow)
- [Data retention](#data-retention)
- [Upgrading and backups](#upgrading-and-backups)
- [Rollback](#rollback)
- [Day-to-day loop](#day-to-day-loop)
- [Troubleshooting](#troubleshooting)

## Status

The monorepo and MVP feature set (Phases 1–9; Phase 0 was docs/standards) **exist** in the repository. Commands on this
page are the day-to-day contract — if reality and this document diverge, one of the two is a
bug and gets fixed in the same PR.

- Layout, Prisma models, and early acceptance criteria: [project-skeleton.md](project-skeleton.md)
- Phase progress (MVP complete): [roadmap.md](roadmap.md)
- Why each tool was chosen: [tech-stack.md](tech-stack.md)

## Prerequisites

| Tool           | Version            | Check                    | Notes                                                                                                                                                                                                        |
| -------------- | ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js        | **≥ 24** (engines) | `node -v`                | Root `package.json` `"engines": { "node": ">=24" }`. Prisma 7 needs ≥ 20.19.0; the project floor is higher. **24 LTS** is the supported line.                                                                |
| pnpm           | 9 or newer         | `pnpm -v`                | Via Corepack: `corepack enable && corepack prepare pnpm@latest --activate`. Corepack is no longer bundled with Node ≥ 25 — there, `npm i -g corepack` first, or install pnpm standalone with `npm i -g pnpm` |
| Docker         | any current        | `docker -v`              | Docker Desktop or Colima on macOS                                                                                                                                                                            |
| Docker Compose | v2 (plugin)        | `docker compose version` | `docker-compose` v1 is not supported                                                                                                                                                                         |
| Git            | 2.30+              | `git --version`          |                                                                                                                                                                                                              |

No local PostgreSQL or Redis installation is needed — both run in Docker.

## Clone and install

```bash
git clone https://github.com/dravcore/kurultay.git
cd kurultay
pnpm install          # installs every workspace package
pnpm db:generate       # generate the Prisma client from apps/api/prisma/schema.prisma
```

The repository is a pnpm workspace (`apps/*`, `packages/*`). Always run `pnpm install` from
the repository root — never inside `apps/api` or `apps/web`.

The generated Prisma client (`apps/api/src/generated/`) is git-ignored and there is no
`postinstall` hook that creates it — `pnpm db:generate` is a required, explicit step on every
fresh clone. Code that imports `@prisma/client`-derived types will not typecheck or build
until you've run it at least once.

`packages/shared-types` and `packages/auth-access` are consumed from their built `dist/`,
which is git-ignored for the same reason, so a fresh clone needs them built before anything
that imports a shared type will run:

```bash
pnpm -r --filter @kurultay/shared-types --filter @kurultay/auth-access build
```

Skipping this does not produce a helpful error. `pnpm test` fails in `apps/web` with
`Failed to resolve entry for package "@kurultay/shared-types"` across every file that imports
a shared type, `pnpm dev` fails in `apps/api` with `TS2307: Cannot find module
'@kurultay/shared-types'`, and `pnpm db:seed` dies with `Cannot find module
'.../@kurultay/auth-access/dist/cjs/index.js'` before it ever reaches the database — all of
which read like a broken checkout rather than a missing build. `pnpm build` and
`pnpm typecheck` both do this for you as a side effect; `pnpm dev`, `pnpm db:seed`,
`pnpm test`, and `pnpm lint` do not. CI builds them explicitly before both the lint and test
jobs.

## Environment variables

```bash
cp .env.example .env
```

Then fill in the blanks. `.env` is git-ignored and must never be committed.

| Variable                              | Example                                                             | Purpose                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                        | `postgresql://kurultay:<POSTGRES_PASSWORD>@localhost:5432/kurultay` | Prisma connection string — password segment must match `POSTGRES_PASSWORD` below                                                                                                                                         |
| `REDIS_URL`                           | `redis://localhost:6379`                                            | Socket.io Redis adapter, caching, BullMQ scheduled jobs (`due-soon` and `cleanup` queues)                                                                                                                                |
| `BETTER_AUTH_SECRET`                  | _(generate)_                                                        | Session signing secret — required, no default                                                                                                                                                                            |
| `BETTER_AUTH_URL`                     | `http://localhost:4000`                                             | Public URL of the API (Better Auth is mounted at `/auth/*`)                                                                                                                                                              |
| `API_PORT`                            | `4000`                                                              | NestJS listen port                                                                                                                                                                                                       |
| `WEB_URL`                             | `http://localhost:3000`                                             | CORS origin for the API                                                                                                                                                                                                  |
| `RATE_LIMIT_ENABLED`                  | `true`                                                              | Master switch for [rate limiting](api-conventions.md#rate-limiting). On by default; only the integration suite turns it off                                                                                              |
| `TRUST_PROXY`                         | `false`                                                             | Reverse-proxy hop(s) to trust for the real client IP — `false` (default), a hop count (`1`), or an IP/CIDR list. See [rate limiting](api-conventions.md#rate-limiting) — **never `true` on a directly-exposed instance** |
| `NEXT_PUBLIC_API_URL`                 | `http://localhost:4000`                                             | API URL compiled into the web bundle — **baked at build time** (Docker builds pass it as a build arg)                                                                                                                    |
| `SMTP_HOST`                           | `localhost` (dev, via Mailpit)                                      | SMTP server host. Unset entirely and the mail module logs instead of sending — see [SMTP and Mailpit](#smtp-and-mailpit)                                                                                                 |
| `SMTP_PORT`                           | `1025` (dev, via Mailpit) / `587` (typical production)              | SMTP server port                                                                                                                                                                                                         |
| `SMTP_USER`                           | _(blank for Mailpit)_                                               | SMTP auth username, if your server requires one                                                                                                                                                                          |
| `SMTP_PASSWORD`                       | _(blank for Mailpit)_                                               | SMTP auth password, if your server requires one                                                                                                                                                                          |
| `SMTP_SECURE`                         | `false`                                                             | `true` for implicit TLS (port 465), `false` for STARTTLS/plaintext (587/25, and Mailpit)                                                                                                                                 |
| `MAIL_FROM`                           | `Kurultay <noreply@example.com>`                                    | `From:` header on outgoing mail                                                                                                                                                                                          |
| `CLEANUP_ENABLED`                     | `true`                                                              | Master switch for the nightly [data-retention sweep](#data-retention). Off means the instance stops enforcing its own retention policy                                                                                   |
| `NOTIFICATION_RETENTION_DAYS`         | `90`                                                                | Days a notification is kept **after it was read**. Unread notifications are never deleted, at any age. `0` = keep forever                                                                                                |
| `ACTIVITY_RETENTION_DAYS`             | `365`                                                               | Days an activity row is kept after it was written. `0` = keep forever — set this if you have a statutory audit-trail duty                                                                                                |
| `DATABASE_POOL_MAX`                   | `20`                                                                | Max simultaneous connections the shared `pg` pool opens to Postgres — see [Database connection pool](#database-connection-pool)                                                                                          |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | `10000`                                                             | How long a request waits for a pool connection before failing, once all `DATABASE_POOL_MAX` are busy — see [Database connection pool](#database-connection-pool)                                                         |
| `DATABASE_STATEMENT_TIMEOUT_MS`       | `30000`                                                             | How long a single SQL statement may run before Postgres kills it — see [Database connection pool](#database-connection-pool)                                                                                             |

`.env.example` also carries `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
`REDIS_PASSWORD`, `BACKUP_INTERVAL`, and `BACKUP_KEEP`. All six are **compose-only** —
`docker-compose.yml` interpolates them into the `postgres`/`redis`/`migrate`/`api`/`backup`
services and no application code reads them directly, so they are absent from the table
above and need no wiring in `apps/api`. See
[Database and cache credentials](#database-and-cache-credentials) for the first four and
[Upgrading and backups](#upgrading-and-backups) for the backup pair.

Generate a secret with:

```bash
openssl rand -base64 32
```

**Adding a new environment variable is a three-step change**, and all three go in the same
PR: wire it through the env helpers in `apps/api/src/common/env.ts` (or the call site that
reads `process.env` — there is no separate Zod/typed env schema today), add it to
`.env.example` with a safe placeholder, and document it in the table above.

## Database and cache credentials

Neither `docker-compose.yml` nor `docker-compose.dev.yml` bakes a well-known
`kurultay`/`kurultay` password into the Postgres container any more — `POSTGRES_PASSWORD` is
a required `.env` value, and compose refuses to start until it is set:

```bash
$ docker compose config
error while interpolating services.migrate.environment.DATABASE_URL: required variable POSTGRES_PASSWORD is missing a value: set POSTGRES_PASSWORD in .env — see docs/development.md#database-and-cache-credentials
```

This is the same fail-loud pattern as `BETTER_AUTH_SECRET` above: a placeholder default would
mean every self-hosted instance that skips reading `.env.example` carefully starts up with a
password every other Kurultay install also has, on a database exposed to whatever else shares
its Docker network.

**Generate `POSTGRES_PASSWORD` and `REDIS_PASSWORD` with `openssl rand -hex 32`, not the
`-base64 32` used for `BETTER_AUTH_SECRET` above.** The difference matters here in a way it
doesn't for `BETTER_AUTH_SECRET`: both of these values are embedded directly in a connection
URL (`DATABASE_URL`/`REDIS_URL`), and we don't percent-encode them, so any of `/ @ : # ? %`
landing in the value corrupts the URL — `/` is the sharpest case, since it ends the
authority section right where it appears:

```bash
$ node -e "new URL('postgresql://kurultay:ab/cd@postgres:5432/kurultay')"
TypeError: Invalid URL
    at new URL (node:internal/url:840:25)
  code: 'ERR_INVALID_URL'

$ openssl rand -hex 32
1b7c3785ecf7f7bd2ec4826214889d19ff17d518ce44126ab6f07393b39b98a   # 0-9a-f only, always URL-safe
```

`-base64 32`'s alphabet includes `/` and `+`; with 43 base64 characters per password, the
odds of at least one `/` or `+` landing in there are `1 - (63/64)^43 ≈ 51%` — roughly a coin
flip on whether a freshly generated password silently breaks its own connection string.
`openssl rand -hex 32` has no such character to avoid.

| Variable            | Default           | Purpose                                                                                                                 |
| ------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`     | `kurultay`        | Postgres role compose creates on first boot and every service connects as                                               |
| `POSTGRES_PASSWORD` | _none — required_ | Postgres role password. No default; `docker compose config`/`up` fails loudly if unset                                  |
| `POSTGRES_DB`       | `kurultay`        | Database name compose creates on first boot                                                                             |
| `REDIS_PASSWORD`    | _(blank)_         | Optional `requirepass` for the `redis` service. Unset keeps Redis passwordless, exactly as before this variable existed |

These four feed the `DATABASE_URL`/`REDIS_URL` that `docker-compose.yml` assembles for its own
`migrate`/`api` services (`postgres:5432`/`redis:6379`, the in-network addresses) — a
**separate** knob from the host-side `DATABASE_URL`/`REDIS_URL` in your `.env` that `pnpm dev`
uses to reach `localhost:5432`/`localhost:6379` in the [dev loop](#run-modes). Compose does
not keep the two in sync: if you change `POSTGRES_PASSWORD` or `REDIS_PASSWORD`, update the
host-side `DATABASE_URL`/`REDIS_URL` to match, or `api`/`web` running on the host will fail to
authenticate against the containers `docker-compose.dev.yml` starts.

`REDIS_PASSWORD` deliberately has no `:?`-required guard like `POSTGRES_PASSWORD` does — Redis
here holds cache entries, sessions, rate-limit counters, and the notification queue, all
rebuildable, never board data (see ["Redis is not backed
up"](#upgrading-and-backups)) — so making it required would break every existing
`docker-compose.yml` on upgrade for comparatively little gain. Leave it blank to keep the
previous passwordless behavior; set it to add defense in depth against another container that
lands on the same Docker network.

**Changing `POSTGRES_PASSWORD` on an existing `postgres_data` volume does not rotate the
running database's password.** The official Postgres image only applies
`POSTGRES_PASSWORD` during `initdb`, i.e. the first time a volume is created — editing `.env`
and restarting an already-initialized stack leaves the role's password exactly as it was. See
the `[Unreleased]` entry in `CHANGELOG.md` for the `ALTER USER ... PASSWORD` command that
rotates it on a running instance.

## Database connection pool

`apps/api/src/prisma/database.ts` opens one process-wide `pg` `Pool` and shares it between
`PrismaService` and Better Auth (`apps/api/src/auth/auth.ts`) — see the module for why they
have to share rather than each opening their own. Three environment variables shape it, all
optional with defaults chosen to be generous enough that ordinary traffic never trips them:

| Variable                              | Default | Purpose                                                                         |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------- |
| `DATABASE_POOL_MAX`                   | `20`    | Max simultaneous connections this instance opens to Postgres                    |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | `10000` | How long a request waits for a connection once all `DATABASE_POOL_MAX` are busy |
| `DATABASE_STATEMENT_TIMEOUT_MS`       | `30000` | How long a single SQL statement may run before Postgres kills it                |

Before `DATABASE_POOL_CONNECTION_TIMEOUT_MS` existed, a request that arrived once the pool was
already at `DATABASE_POOL_MAX` connections queued with no ceiling — `pg`'s own default there is
`0`, i.e. wait forever. Under sustained load that turned pool saturation into requests that
never resolved instead of a clear, logged error. `DATABASE_STATEMENT_TIMEOUT_MS` closes the
matching gap on the query side: without it, one runaway statement (a missing index hit by a
large scan, a pathological filter) holds a connection — and one of the `DATABASE_POOL_MAX`
slots — indefinitely.

`DATABASE_STATEMENT_TIMEOUT_MS` is applied **per connection this pool opens**, as a Postgres
startup parameter (`pg`'s own handshake, not a query this codebase issues), so it reaches only
traffic that goes through `getSharedPool()`:

- `prisma migrate deploy` / `prisma migrate dev` are unaffected — migrations run through
  Prisma's own engine process against `DATABASE_URL` directly, never through this pool.
- `pnpm db:seed` (`apps/api/prisma/seed.ts`) is unaffected for its own bulk deletes and
  inserts — it opens a separate `Pool` for those. The one part of seeding that _does_ cross
  the shared pool is the Better Auth calls it makes (`signUpEmail`, `createOrganization`),
  which are ordinary lightweight queries nowhere near the 30s default.

Raise `DATABASE_POOL_MAX` alongside Postgres's own `max_connections` if an instance is
consistently queuing under normal load rather than only during spikes; an unbounded pool does
not fix that, it just moves the exhaustion from this app to whatever else shares the database.

## SMTP and Mailpit

Kurultay sends email for one flow today: the verification link an invitee needs before
`accept-invitation` will let them join a workspace (see
[`decisions/0013-invitation-email-verification.md`](decisions/0013-invitation-email-verification.md)).
Leaving `SMTP_HOST` unset is a valid choice — the API still boots, and the mail module logs
the message instead of sending it — but while that's true, **no invitation can be accepted**.
To exercise the real flow locally without sending real mail, use the `mailpit` service that
`docker-compose.dev.yml` already starts alongside `postgres` and `redis`:

```bash
docker compose -f docker-compose.dev.yml up -d   # postgres + redis + mailpit
```

Then set these in your `.env` (already the defaults suggested by `.env.example`, but Mailpit
needs the host/port explicitly pointed at it):

```bash
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
# SMTP_USER / SMTP_PASSWORD stay blank — Mailpit does not require auth
MAIL_FROM=Kurultay <noreply@example.com>
```

| URL                   | What                                                                        |
| --------------------- | --------------------------------------------------------------------------- |
| http://localhost:8025 | Mailpit web UI — every message the API sends lands here, never a real inbox |
| localhost:1025        | Mailpit's SMTP listener — what `SMTP_HOST`/`SMTP_PORT` above point at       |

To test the invitation flow end to end: send an invitation from the app, open
http://localhost:8025, click into the newest message, and open the verification link it
contains in your browser (or copy it — Mailpit renders the plain-text and HTML parts, and
the link works the same either way). The invitee's account is now verified and
`accept-invitation` succeeds. `docker compose -f docker-compose.dev.yml down -v` clears
Mailpit's stored messages along with the Postgres/Redis volumes.

## Run modes

### Recommended: dev loop (services in Docker, apps on host)

Postgres and Redis run in containers; `api` and `web` run on the host with hot reload. This
is the fast loop — no image rebuild between code changes.

```bash
pnpm db:generate                                 # generate the Prisma client (skip if already done)
docker compose -f docker-compose.dev.yml up -d   # postgres + redis only
pnpm db:migrate                                  # apply migrations
pnpm dev                                         # api + web in parallel, hot reload
```

| URL                          | What                           |
| ---------------------------- | ------------------------------ |
| http://localhost:3000        | Web app (Next.js)              |
| http://localhost:4000        | API (NestJS)                   |
| http://localhost:4000/health | Health check — must return 200 |

Stop the containers with `docker compose -f docker-compose.dev.yml down` (add `-v` to also
drop the database volume and start from a clean slate).

### Full stack in Docker

Everything containerized, closest to production. Use it to verify the Dockerfiles and
compose wiring, or when you just want to run Kurultay rather than develop it.

```bash
docker compose up --build
```

This also starts the `backup` sidecar, which dumps the database on a schedule — see
[Upgrading and backups](#upgrading-and-backups). `docker-compose.dev.yml` has no such
service: the dev loop's database is throwaway by design.

|                             | Dev loop             | Full Docker                                       |
| --------------------------- | -------------------- | ------------------------------------------------- |
| Hot reload                  | Yes                  | No — rebuild required                             |
| Startup after a code change | seconds              | tens of seconds                                   |
| Matches production          | Partially            | Yes                                               |
| Use for                     | Everyday development | Verifying images, release checks, running the app |

## pnpm scripts

Run from the repository root.

| Script           | Command               | What it does                                                                                                                                                                                                                                            |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`            | `pnpm dev`            | Runs `apps/api` and `apps/web` in parallel with hot reload                                                                                                                                                                                              |
| `build`          | `pnpm build`          | Builds every workspace package                                                                                                                                                                                                                          |
| `lint`           | `pnpm lint`           | ESLint across all packages                                                                                                                                                                                                                              |
| `format`         | `pnpm format`         | Prettier write across the repo                                                                                                                                                                                                                          |
| `format:check`   | `pnpm format:check`   | Prettier check (CI gate)                                                                                                                                                                                                                                |
| `typecheck`      | `pnpm typecheck`      | Builds `@kurultay/shared-types` + `@kurultay/auth-access`, then `tsc --noEmit` in every workspace                                                                                                                                                       |
| `test`           | `pnpm test`           | Runs the test suites of every workspace package                                                                                                                                                                                                         |
| `db:generate`    | `pnpm db:generate`    | Runs `prisma generate`: (re)builds the Prisma client from the schema. Does not touch migrations or the database. Required after cloning and after pulling schema/migration changes someone else made                                                    |
| `db:migrate`     | `pnpm db:migrate`     | Runs `prisma migrate deploy`: applies existing, already-committed migrations. Never creates a migration and never regenerates the client — safe for CI/production. If you only ran this after pulling new migrations, follow it with `pnpm db:generate` |
| `db:migrate:dev` | `pnpm db:migrate:dev` | Runs `prisma migrate dev`: diffs your local schema, **creates a new migration file**, applies it, and regenerates the client. This is the command you run locally after editing `schema.prisma` — `db:migrate` alone will not create it                 |
| `db:seed`        | `pnpm db:seed`        | Loads demo data: one workspace, one board, default columns, a handful of tasks. Under Prisma 7 the seed entry point is declared in `prisma.config.ts` — seeding is never automatic and must be invoked explicitly                                       |
| `db:studio`      | `pnpm db:studio`      | Opens Prisma Studio at http://localhost:5555                                                                                                                                                                                                            |

To target a single workspace, use pnpm's filter flag:

```bash
pnpm --filter @kurultay/api dev
pnpm --filter @kurultay/web build
pnpm --filter @kurultay/api test
```

## Database workflow

```bash
# 1. Edit apps/api/prisma/schema.prisma
# 2. Create and apply a migration, and regenerate the client
pnpm db:migrate:dev
# 3. Load demo data (empty boards are hard to develop against)
pnpm db:seed
# 4. Inspect the data
pnpm db:studio
```

Use `pnpm db:migrate:dev`, not `pnpm db:migrate`, to create the migration — `db:migrate` only
applies migrations that already exist (`prisma migrate deploy`) and will not generate one from
your schema edit. `db:migrate:dev` also regenerates the Prisma client, so no separate
`pnpm db:generate` step is needed here.

When you're instead picking up migrations someone else already committed (e.g. after
`git pull`), use `pnpm db:migrate` followed by `pnpm db:generate` — `db:migrate` applies them
but, unlike `db:migrate:dev`, does not regenerate the client.

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

## Data retention

Kurultay deletes rows it is no longer entitled to keep. A BullMQ job runs **once a day** on
`REDIS_URL` — the same mechanism as the due-soon scan — and sweeps four tables:

| Table          | Deleted when                        | Setting                                      |
| -------------- | ----------------------------------- | -------------------------------------------- |
| `Session`      | `expiresAt` has passed              | none — not configurable                      |
| `Verification` | `expiresAt` has passed              | none — not configurable                      |
| `Notification` | read, and read more than N days ago | `NOTIFICATION_RETENTION_DAYS` (default `90`) |
| `Activity`     | written more than N days ago        | `ACTIVITY_RETENTION_DAYS` (default `365`)    |

The reasoning behind each window — and why `Activity` is deleted at a year rather than
archived or kept — is [ADR 0020](decisions/0020-data-retention.md).

Two things worth knowing before you change any of this:

- **Unread notifications are never deleted, at any age.** The window is measured from
  `readAt`, not from `createdAt`.
- **`0` means "keep forever"** for either window. Set `ACTIVITY_RETENTION_DAYS=0` if you have
  a statutory duty to retain an audit trail. A negative value is refused at startup rather
  than clamped — it would be a cutoff in the future, which would delete live rows.

Each run writes one JSON line to stdout with the number of rows deleted per table and nothing
else — no identifiers, no payloads:

```json
{
  "ts": "2026-08-14T03:00:01.204Z",
  "level": "info",
  "event": "retention.cleanup",
  "durationMs": 41.8,
  "sessions": 132,
  "verifications": 9,
  "notifications": 2140,
  "activities": 0
}
```

The line is written even when every count is zero, so its absence is a signal that the job
stopped running.

`CLEANUP_ENABLED=false` disables the sweep completely, at the point of deletion rather than
only at startup — a job definition left in Redis by an earlier deployment cannot outlive the
switch. The integration suite runs with it off (`test/setup-e2e.ts`) and turns it on around
its own assertions; a global scheduled `DELETE` is not something you want running in the
background of a suite whose fixtures are backdated rows.

Deleting is batched (1000 rows per statement) so a first run against a long-lived instance
never becomes one long transaction holding locks and blocking autovacuum.

## Upgrading and backups

This applies to anyone running Kurultay with data they care about, not to throwaway local
databases. Pre-1.0, breaking schema changes can ship in any `0.y.0` release
([git-strategy.md](git-strategy.md#versioning-policy-semver)), so there are two rules: let
the scheduled backup run, and **take one more dump immediately before every upgrade.**

### The scheduled backup sidecar

`docker compose up` starts a `backup` service alongside `postgres`. It runs
[`scripts/backup.sh`](../scripts/backup.sh) from a `postgres:18-alpine` container — the same
image as the server, so `pg_dump`/`pg_restore` always match the server major — and loops:

1. `pg_dump --format=custom` into the `backup_data` volume as
   `/backups/kurultay-<UTC timestamp>.dump` (written as `.part` and renamed on success, so an
   interrupted dump never looks like a finished archive),
2. delete everything past the newest `BACKUP_KEEP` archives,
3. sleep `BACKUP_INTERVAL` seconds, repeat.

The defaults — one dump a day, seven kept — mean **a recovery point at most 24 hours old
(RPO ≤ 24 h) and a week of history**, with no cron on the host and nothing to remember. The
service is `restart: unless-stopped`: a backup sidecar that stays down after a reboot
silently stops producing recovery points, which is the failure this whole section exists to
prevent. It is deliberately **not** in `docker-compose.dev.yml` — a local database that
`pnpm db:seed` wipes on demand has nothing worth keeping.

Two settings, both read from `.env` by compose (they are compose-only — no application code
reads them, so they are not part of the [environment variables](#environment-variables) the
API loads):

| Variable          | Default | Purpose                                                       |
| ----------------- | ------- | ------------------------------------------------------------- |
| `BACKUP_INTERVAL` | `86400` | Seconds between dumps. `86400` = daily; this **is** your RPO  |
| `BACKUP_KEEP`     | `7`     | Archives retained; older ones are deleted after each new dump |

Check on it — an untested backup is not a backup, and neither is an unread log:

```bash
docker compose logs backup | tail            # "wrote /backups/kurultay-….dump (… bytes)"
docker compose exec backup ls -lh /backups   # newest archive, and how many are kept
```

**Copy the archives off-host.** `backup_data` sits on the same disk as `postgres_data`, so it
covers "I dropped the wrong table" and covers nothing about a dead disk or a lost server —
mirror the volume somewhere else on a schedule (`rsync`/`rclone` from
`docker compose exec -T backup cat /backups/<archive>`, or straight from the volume's host
path) or the disaster case still loses everything.

### Taking a dump by hand

Before an upgrade, or any time you want a recovery point now rather than up to
`BACKUP_INTERVAL` from now, run the same script once — it writes into the same volume and
prunes by the same rule:

```bash
docker compose exec backup /bin/sh /usr/local/bin/backup.sh once
```

To hold a copy outside the volume (recommended before an upgrade, since it survives a
`docker compose down -v`):

```bash
docker compose exec -T postgres \
  pg_dump -U kurultay --format=custom kurultay > kurultay-$(date -u +%Y%m%dT%H%M%SZ).dump
```

- Read the `CHANGELOG.md` entry for the target version first — every breaking change carries
  a migration note there.
- Then upgrade the images and run the migrations.
- If the upgrade goes wrong, see [Rollback](#rollback).

### Restoring from a backup

**Target: back up in under two hours (RTO ≤ 2 h) from the decision to restore.** The
procedure below runs in seconds on a small instance; the budget is for the deciding, the
finding of the right archive, and the verifying. It has been rehearsed end to end — a seeded
database dumped by `scripts/backup.sh` and restored into an empty server reproduced all 17
tables, every row count, all 59 indexes, `pg_trgm`, and the `_prisma_migrations` table intact.

Restore is `pg_restore` (the archives are `--format=custom`, not SQL text), and it wants an
**empty** database — restoring over a populated one produces duplicate-key errors, not a
clean overwrite.

```bash
# 1. Stop everything that writes — including the backup sidecar, so it cannot dump the
#    half-restored database and rotate a good archive out. Postgres itself stays up.
docker compose stop web api backup

# 2. Pick the archive to restore. `run --rm` because the sidecar is stopped now; the
#    throwaway container mounts the same backup_data volume.
docker compose run --rm --entrypoint ls backup -1 /backups

# 3. Recreate the database empty. This is the destructive step — everything written after
#    the archive was taken is gone from here on.
docker compose exec -T postgres psql -U kurultay -d postgres \
  -c 'DROP DATABASE kurultay WITH (FORCE);' \
  -c 'CREATE DATABASE kurultay OWNER kurultay;'

# 4. Restore. --exit-on-error turns a partial restore into a loud failure instead of a
#    half-populated database that looks fine.
docker compose run --rm --entrypoint pg_restore backup \
  --host=postgres --username=kurultay --dbname=kurultay \
  --no-owner --exit-on-error /backups/kurultay-<timestamp>.dump

# 5. Check the migration state. The archive carries _prisma_migrations, so the recorded
#    state matches the restored schema and this should report nothing to do.
docker compose run --rm migrate

# 6. Verify before letting traffic back in.
docker compose exec -T postgres psql -U kurultay -d kurultay \
  -c '\dt' \
  -c 'SELECT count(*) FROM "User";' \
  -c 'SELECT count(*) FROM "Workspace";' \
  -c 'SELECT count(*) FROM "Task";' \
  -c 'SELECT count(*) FROM "_prisma_migrations";'

# 7. Bring the stack back.
docker compose up -d
```

If the checked-out code is newer than the archive's schema, step 5 applies the missing
migrations forward, which is correct. If it is **older**, check out the release tag that
matches the archive before step 5 — see [Rollback](#rollback).

Restoring from a host-side file instead of one in the volume (step 4 variant):

```bash
docker compose run --rm -T --entrypoint pg_restore backup \
  --host=postgres --username=kurultay --dbname=kurultay --no-owner \
  --exit-on-error < kurultay-20260813T194856Z.dump
```

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

### Index migrations take a write lock

**Every index in `apps/api/prisma/migrations/` is created with a plain `CREATE INDEX`, which
takes a `SHARE` lock on the table for the whole build.** Reads continue; **writes to that
table block until the index finishes.** On a fresh or small database this is milliseconds and
invisible. On a large one it is a write outage lasting as long as the build.

The two that matter most are the trigram GIN indexes in
`20260809190000_task_trgm_search_indexes` — `Task_title_idx` and `Task_description_idx`. GIN
builds over text are among the slowest index builds there are, and `Task` is the
fastest-growing table in the schema.

This is a deliberate trade-off, not an oversight. `CREATE INDEX CONCURRENTLY` cannot run
inside a transaction block, and `prisma migrate deploy` wraps each migration in one — so
using it would mean hand-writing migrations Prisma cannot apply, in exchange for a lock that
is imperceptible on every database this project has actually been deployed to. Prisma's own
guidance for the case is the manual path below.

**Before upgrading an instance with a large `Task` table (roughly: past a few hundred
thousand rows), or any instance that cannot take a write pause:**

1. Read the new migrations in the release before applying them:
   `git diff <current-tag>..<target-tag> -- apps/api/prisma/migrations`.
2. If one creates an index on a large table, apply that statement yourself first, with
   `CONCURRENTLY`, while the old version is still serving traffic:

   ```bash
   docker compose exec -T postgres psql -U kurultay kurultay -c \
     'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_title_idx" ON "Task" USING GIN ("title" gin_trgm_ops);'
   ```

   `CONCURRENTLY` does not block writes, but it cannot run inside a transaction and takes
   roughly twice as long. If it fails it leaves an **invalid** index behind, which must be
   dropped (`DROP INDEX CONCURRENTLY "Task_title_idx";`) before retrying — check with
   `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`.

3. Then run `pnpm db:migrate` as usual. The migration's own `CREATE INDEX` is a no-op against
   an index that already exists under the same name, so the deploy takes no lock.

Do not do this routinely — for a normal-sized instance, step 3 alone is correct and the whole
procedure is wasted effort. It is a release-note-driven escape hatch for the one case where
the default would hurt.

`CREATE EXTENSION IF NOT EXISTS pg_trgm` in that same migration needs superuser or
`pg_database_owner` rights. A managed Postgres that restricts extensions must have `pg_trgm`
enabled by its provider before the migration runs.

## Rollback

What to do when an upgrade or release goes bad and the last known-good version has to come
back. Two different things can need rolling back, and they move independently: the
**application** (the code the containers run) and the **database schema** (the applied Prisma
migrations). Rolling the application back is cheap and fast; rolling a migration back is not —
read the migration part before you need it at 2 a.m.

### Rolling back the application

There are no published registry images — `docker compose up` builds `api` and `web` from
whatever source tree is checked out (see `docker-compose.yml`). Rolling back the application
therefore means checking out the previous release tag and rebuilding the images:

```bash
git fetch --tags
git switch --detach v0.1.0        # the last known-good tag — list them with `git tag -l`
docker compose up -d --build      # rebuild api + web from that tree and restart
```

The one-shot `migrate` service runs on every `up`, but it only **applies** migrations that
exist in the checked-out tree (`prisma migrate deploy`) — it never reverts migrations the
database has that the tree does not. So after a code rollback the database keeps the newer
schema. If the bad release's migrations were purely additive (new tables, new nullable
columns, new indexes), the older code runs fine against that schema and the code rollback
alone is the whole procedure. If the bad release renamed or dropped something the older code
reads, a code-only rollback will crash on boot — that is the migration-rollback case below.

### Rolling back a migration

**Prisma does not generate down migrations.** Every directory under
`apps/api/prisma/migrations/` contains a forward-only `migration.sql`; there is no
`migrate down` command and no automated revert path. The options, in order of preference:

1. **Forward-fix (preferred).** Write a **new** migration that undoes or repairs the bad
   change — drop the bad column, restore the old name, backfill the data — author it locally
   with `pnpm db:migrate:dev`, and deploy forward as usual. History stays linear, no data is
   thrown away beyond what the bad migration itself destroyed, and no committed migration
   file is ever edited. Ship it through the hotfix flow below.
2. **Restore from a backup.** The `backup` sidecar gives you one at most `BACKUP_INTERVAL`
   old (24 hours by default), and [the section above](#upgrading-and-backups) says to take
   one more immediately before every upgrade — that fresher archive is the one you want here.
   Everything written after the archive was taken is **permanently lost**: the recovery point
   is the moment `pg_dump` ran, so on a live instance this trades user data for schema. Use
   it when the bad migration itself destroyed data (dropped a column or table) that the
   archive still has.

   Follow [Restoring from a backup](#restoring-from-a-backup) in full, with one addition —
   check out the release tag that matches the archive before you bring the stack back, so the
   code and the schema agree:

   ```bash
   git switch --detach v0.1.0         # the release that matches the archive
   docker compose up -d --build
   ```

   The archive contains the `_prisma_migrations` bookkeeping table, so after the restore the
   recorded migration state matches the restored schema, and the old release's `migrate`
   service finds nothing left to apply.

3. **`prisma migrate resolve` — marking, not reverting.** `resolve` edits only the
   `_prisma_migrations` bookkeeping table; it changes no schema and restores no data. Its
   scenario is a migration that **failed halfway** and now blocks every `migrate deploy`:
   repair the database by hand (or restore it), then — from `apps/api` — either
   `pnpm exec prisma migrate resolve --rolled-back <migration_name>` so the next deploy
   retries it, or `--applied <migration_name>` so the next deploy skips it. Reaching for it
   to "undo" a migration that succeeded does nothing to the schema — that misuse only makes
   the bookkeeping lie.

### Never `migrate reset` in production

`prisma migrate reset` drops and recreates the entire database. It is a dev-loop convenience
for throwaway local data, never a rollback tool, and nothing stops it from pointing at
production except the `DATABASE_URL` in your shell. The seed is the same shape of hazard:
`pnpm db:seed` starts by deleting **every row in every table** before inserting demo data,
which is why [`apps/api/prisma/seed.ts`](../apps/api/prisma/seed.ts) refuses to run when
`NODE_ENV` is `production`
([`apps/api/src/common/seed-guard.ts`](../apps/api/src/common/seed-guard.ts)) — deliberately
with no override flag. `migrate reset` has no such guard. The rule at 2 a.m. is absolute:
neither command ever runs against a database you cannot afford to recreate from a dump.

### Rollback and the hotfix flow

A rollback buys time; it is not the fix. The durable fix ships as a `hotfix/*` branch from
`main` — [git-strategy.md](git-strategy.md#hotfix-process): branch, fix (including any
forward-fix migration from option 1 above), bump the patch version, PR into `main`, tag,
back-merge to `develop`, then upgrade production onto the new tag — which is also what ends
the rollback. If the bad release was `v0.2.0` and production is parked on `v0.1.0`, the
hotfix ships as `v0.2.1`; do not stay parked on the old tag longer than it takes to ship it.

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

| Symptom                                        | Cause                                                             | Fix                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ECONNREFUSED 127.0.0.1:5432`                  | Postgres container is not up                                      | `docker compose -f docker-compose.dev.yml up -d`                              |
| `Environment variable not found: DATABASE_URL` | `.env` missing                                                    | `cp .env.example .env` and fill it in                                         |
| Port 3000/4000/5432 already in use             | Another process or a stale container                              | `docker compose down`, or change the port in `.env`                           |
| Prisma types out of date after pulling         | Client not regenerated — `pnpm db:migrate` does not regenerate it | `pnpm db:generate` (after applying any new migrations with `pnpm db:migrate`) |
| Freshly generated client not picked up         | A running `pnpm dev` keeps the old client in `dist`               | Restart `pnpm dev` after `pnpm db:generate` — assets are copied at (re)start  |
| `pnpm install` fails with a workspace error    | Ran inside a sub-package                                          | Run it from the repository root                                               |

## See also

- [project-skeleton.md](project-skeleton.md) — the layout and acceptance criteria this
  document is the contract for
- [roadmap.md](roadmap.md) — phase order
- [git-strategy.md](git-strategy.md) — branches, commits, releases
- [coding-standards.md](coding-standards.md) — how the code inside these apps is written
- [testing.md](testing.md) — how to run and write tests
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — contribution process
