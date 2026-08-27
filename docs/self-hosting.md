# Self-hosting Kurul on your own domain

Put Kurul on a server, on your domain, with HTTPS and working email. Everything below is
one page on purpose; budget about an hour, most of it waiting for DNS.

> 🌐 English (canonical) | [Türkçe](tr/self-hosting.md)

There is no build step. `docker compose pull` fetches images published for every release, and
the same image works on every domain — the API URL is not compiled into it (see
[Why there is no rebuild](#why-there-is-no-rebuild) if you want the reasoning).

> **Installing v0.2.0 or older? Use `git clone` instead.** Releases up to and including
> v0.2.0 published only the `api` and `web` images; the third one this page pulls,
> `kurul-migrate`, exists from v0.3.0 onward. The download step below fetches no source tree to
> build it from, so on v0.2.0 the steps on this page cannot start the stack: install from a
> clone as shown in [Troubleshooting](#troubleshooting), and come back to this page from v0.3.0
> on.

## What you need

- A server with a public IP, Docker Engine 24+ and the Compose plugin. Two CPUs and 2 GB of
  RAM is enough for a small team — see [Server sizing](#server-sizing) for how that 2 GB is
  actually spent.
- A domain you control, with **ports 80 and 443 open** to that server. Both are required:
  Let's Encrypt validates over port 80, browsers use 443.
- An SMTP account. Kurul needs outgoing mail before anyone can accept an invitation — see
  [Email](#email-smtp) for why, and what happens if you skip it.
- A host firewall that allows nothing inbound beyond SSH, 80 and 443. Everything else this
  stack runs stays off the public internet on its own: `proxy` is the only service in
  `docker-compose.yml` with a `ports:` entry, so Postgres, Redis, the API and the web app are
  reachable only over Docker's internal network. `docker compose ps` is how you confirm that on
  your own machine — every row except `proxy` should show a bare container port
  (`4000/tcp`, `5432/tcp`, …) with no `0.0.0.0:` mapping in front of it.

  The firewall still earns its place, for one reason worth knowing before you trust it: on
  Linux, Docker publishes ports by writing its own iptables rules, and those are consulted
  _before_ ufw's. A container port you publish — in a `docker-compose.override.yml`, say, to
  "temporarily" reach Postgres — is exposed to the internet even with `ufw deny 5432` in place.
  The firewall protects the things Docker is not managing; the `ports:` list is what protects
  the rest, which is why this stack keeps it to one service.

## Server sizing

Every service in `docker-compose.yml` carries a `mem_limit` (OPS-05, 2026-08-18 audit). Before
this, nothing capped how much memory any one container could take, so on a host near its 2 GB
budget the _kernel_ OOM killer picked which process died — it scores every process on the host,
not just this stack's, and has no reason to spare Postgres over whichever container actually
grew. A `mem_limit` puts that decision back where it belongs: a container is only ever killed
for outgrowing its own ceiling, and nothing another service does can take Postgres down with it.

| Service    | `mem_limit` | Why this number                                                                                  |
| ---------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `postgres` | 512m        | Generous baseline for a small-team board's working set; `/dev/shm` raised to 256m, see below     |
| `api`      | 512m        | `REQUEST_BODY_MAX_BYTES` / `ATTACHMENT_MAX_BYTES` (`.env.example`) both buffer into its heap     |
| `web`      | 512m        | Same Next.js SSR process, same "no ceiling chosen" problem as `api`                              |
| `migrate`  | 512m        | Matches `api`: same build stage, same Prisma CLI, just once at startup                           |
| `backup`   | 256m        | `pg_dump` streams rather than buffering; this covers process overhead and the attachments `tar`  |
| `redis`    | 128m        | Cache, sessions, rate limits, notifications only, never board data; `maxmemory` 100mb, see below |
| `proxy`    | 128m        | Terminates TLS and proxies; bodies pass through Caddy rather than buffering into it              |

`api` and `web` also set `NODE_OPTIONS=--max-old-space-size=384` — 75% of their 512m ceiling —
so V8's heap is pinned explicitly rather than left to Node's own container-memory heuristic. The
remaining 128m of headroom below `mem_limit` is for what a heap ceiling alone doesn't cover
(thread stacks, native buffers, code space): V8 hits its own catchable "JavaScript heap out of
memory" before the cgroup's hard limit does, which shows up as a line in `docker compose logs
api` (or `web`) instead of a bare `SIGKILL`.

`redis` gets the same treatment inside its 128m: `--maxmemory 100mb --maxmemory-policy
noeviction` on its command line, so a Redis that fills up answers writes with
`OOM command not allowed when used memory > 'maxmemory'` (a line in `docker compose logs api`;
the API's rate limiters fall back to process memory while Redis is erroring, and a cache miss is
a cache miss) instead of being killed by the cgroup and restarted in a loop. `noeviction` is
what BullMQ, whose notification and retention queues live in this Redis, requires: an evicted
job is a job that silently never runs, so a full Redis refuses writes rather than dropping keys.
`postgres` carries `shm_size: 256m` because Docker's `/dev/shm` is 64 MB by default and Postgres
allocates dynamic shared memory for parallel workers and hash joins there; running out surfaces
as `could not resize shared memory segment ... No space left on device` on a heavy dashboard
query. Neither is memory on top of the ceilings in the table: a `/dev/shm` page is charged to
the container's cgroup like any other, and `maxmemory` is a limit Redis enforces on itself under
the one Docker enforces on it.

`REDIS_MAXMEMORY` in `.env` raises that ceiling without touching `docker-compose.yml`; raise the
`redis` `mem_limit` alongside it so Redis still hits its own limit before the cgroup's. Before
raising it on an instance that is already running, check where the dataset actually sits:
`docker compose exec redis redis-cli -a "$REDIS_PASSWORD" INFO memory | grep used_memory_human`.
With `noeviction`, a dataset already over the ceiling does not shrink itself back under it: it
refuses every write until enough keys expire on their own, which is why the check has to come
before the number, not after.

These are ceilings, not reservations — a container using less than its `mem_limit` costs nothing
extra, and `migrate` in particular exits (successfully) before `api` and `web` finish starting,
so it is never actually concurrent with them. Summed as if every long-running service hit its
ceiling at once — `postgres` + `api` + `web` + `redis` + `proxy` + `backup`, excluding `migrate`,
which by the time the others are up has already exited — that is 512 + 512 + 512 + 128 + 128 +
256 = 2048 MB, which is exactly the 2 GB this page has always asked for. A host with less
headroom than that under real traffic is a reason to raise these numbers (`docker-compose.yml`
is a plain edit, or override them in a `docker-compose.override.yml`) or the box's own RAM, not
to remove the ceiling — see the note above for what removing it gets you back.

**Not verified by measurement**: these numbers come from the request/attachment ceilings already
documented in `.env.example` and from V8's own heap-sizing conventions, not from running the
stack under load at each limit. If a container is killed for hitting its `mem_limit` in
practice, `docker compose ps` shows it exited (often `137`), and `docker compose logs <service>`
is the place to start — raise that one service's limit rather than every service's.

## 1. DNS

Point the hostname at your server and let it propagate before you start the stack — Caddy asks
for a certificate on its first boot, and a request that fails because DNS is not live yet
counts against Let's Encrypt's rate limit.

```
kurul.example.com.   A     203.0.113.10
kurul.example.com.   AAAA  2001:db8::10      # only if the server has IPv6
```

Check it from somewhere that is not the server itself:

```bash
dig +short kurul.example.com
```

## 2. Fetch the compose file and configure

The URLs below name a release tag, `v0.4.0`, and the same tag goes into `.env` as `TAG` a few
lines further down. Fetch the files from the release you are going to run, not from `main`:
`docker-compose.yml`, `docker/Caddyfile` and `scripts/backup.sh` are versioned with the images,
and a compose file from a newer tree can name a service, a variable or an image the release you
pinned never shipped. To install a different release, replace `v0.4.0` in every URL and in
`TAG`.

```bash
mkdir -p /opt/kurul && cd /opt/kurul
curl -fsSLO https://raw.githubusercontent.com/dravcore/kurul/v0.4.0/docker-compose.yml
curl -fsSL --create-dirs -o docker/Caddyfile \
  https://raw.githubusercontent.com/dravcore/kurul/v0.4.0/docker/Caddyfile
curl -fsSL --create-dirs -o scripts/backup.sh \
  https://raw.githubusercontent.com/dravcore/kurul/v0.4.0/scripts/backup.sh
chmod +x scripts/backup.sh
curl -fsSL -o .env https://raw.githubusercontent.com/dravcore/kurul/v0.4.0/.env.example
chmod 600 .env
```

`scripts/backup.sh` is not optional: the `backup` service in `docker-compose.yml` bind-mounts
that exact path into its container, and without the file the scheduled backups that service
exists to take never run. `chmod 600 .env` because the file is about to hold the database
password, the session secret and the SMTP password; the `rclone.env` advice in
[Off-host copies](#off-host-copies) is the same rule.

Edit `.env`. For a Docker-only install these are the lines that matter — everything else in the
file is either for the development loop or has a working default:

```bash
TAG=v0.4.0                                  # the release the files above came from

SITE_URL=https://kurul.example.com          # your domain, scheme included

POSTGRES_PASSWORD=<openssl rand -hex 32>       # hex, not base64 — it goes inside a URL
BETTER_AUTH_SECRET=<openssl rand -hex 32>      # session signing key

SMTP_HOST=smtp.example.com                     # see "Email" below
SMTP_PORT=587
SMTP_USER=kurul@example.com
SMTP_PASSWORD=<your smtp password>
SMTP_SECURE=false                              # true only for port 465
MAIL_FROM=Kurul <kurul@example.com>
```

Generate both secrets with `openssl rand -hex 32`. `POSTGRES_PASSWORD` is embedded directly in
a connection URL, which is why `-base64` is the wrong generator for it; the reason is written
down once, in
[development.md](development.md#database-and-cache-credentials). `BETTER_AUTH_SECRET` is only
ever byte-compared and carries no such constraint, but generating it with `-hex` too means one
generator to remember instead of a per-variable rule.

`SITE_URL` carries the scheme because that is what decides whether Caddy serves plain HTTP or
obtains a certificate. `https://…` switches automatic HTTPS on. `http://localhost` (the
default) is the local, no-domain install.

**Attachments need no line here.** `docker-compose.yml` sets `STORAGE_PATH` itself, to a
directory inside the `attachment_data` volume, so a Compose install accepts file uploads out of
the box — the `.env` copy of that variable is for the development loop only. The one value you
may want to change is `ATTACHMENT_MAX_BYTES` (default `26214400`, 25 MiB), and if you do, read
[the proxy contract below](#bringing-your-own-reverse-proxy) first: the reverse proxy carries a
separate, deliberately higher ceiling that has to move with it.

**Attachment storage is capped by default, and it shares Postgres's disk.** The
`attachment_data` volume lives on the same host filesystem as the database, so a full disk
stops Postgres, not just uploads. Two variables cap the total
([ADR 0027](decisions/0027-attachment-quotas.md), updated 2026-08-21):
`ATTACHMENT_WORKSPACE_QUOTA_BYTES` (summed stored-file bytes per workspace) and
`ATTACHMENT_INSTANCE_QUOTA_BYTES` (the whole instance). Unset, they are **2 GiB per workspace
(`2147483648`) and 20 GiB per instance (`21474836480`)**; a written `0` lifts one entirely, and
a negative value refuses to boot. Set the instance one below your volume's real headroom on
any machine whose disk you care about. The API logs the effective numbers at start
(`Attachment ceilings: … (default)` / `(env)` in `docker compose logs api`), and warns, rather
than refusing, if the workspace quota is set above the instance quota. When sizing, know that
the quotas are **soft** (simultaneous uploads can each overshoot by at most one file, so leave
a few `ATTACHMENT_MAX_BYTES` of slack) and that deleted files keep their bytes until the
nightly orphan sweep's grace period passes, so disk usage briefly exceeds what the quota
accounts for. Link attachments store no bytes and never count. A rejected upload is a `413`
whose JSON body carries `error: "Attachment Quota Exceeded"`, see
[Telling the 413s apart](#telling-the-413s-apart).

**Uploads are also budgeted in bytes per minute.** `ATTACHMENT_UPLOAD_BYTES_PER_MINUTE`
(default `268435456`, 256 MiB, about ten max-size uploads) is the most one client IP may submit
to the upload route in a fixed minute, charged from each request's `Content-Length` before the
body is read (a multipart request without one is charged `ATTACHMENT_MAX_BYTES`). It exists
because the per-route request throttle counts requests, which is the wrong unit for disk. `0`
switches it off. It is keyed by the same client IP as every other limit, so it needs the
`TRUST_PROXY` setting the bundled Compose file already carries to see through the proxy; the
counters live in Redis and fall back to process memory while Redis is erroring. Over budget is
a `429` whose JSON body carries `error: "Upload Budget Exceeded"` and a `Retry-After` header
([api-conventions.md](api-conventions.md#rate-limiting)).

**Nothing else is capped unless you cap it.** Four variables put ceilings on _quantities_
rather than bytes ([ADR 0032](decisions/0032-plan-limits.md)), and all four are unset in
`.env.example`: `PLAN_MAX_SEATS_PER_WORKSPACE`, `PLAN_MAX_BOARDS_PER_WORKSPACE`,
`PLAN_MAX_WORKSPACES` and `PLAN_MAX_USERS`. **Unset means unlimited**, which is what an
instance that never touches this block runs: no counting query is issued at all. A written `0`
also means unlimited; a negative or non-integer value refuses to boot, and the effective
numbers are logged at start (`Plan ceilings: …`). These deliberately have no defaults where
the attachment quotas do: a full disk takes the database down with it, while a tenth board
costs one row. The bundled `docker-compose.yml` forwards all four to the `api` container; a
compose file of your own has to do the same, because the container never reads `.env` itself.

A **seat** is a member _or_ an invitation still waiting to be accepted, so an admin at the
ceiling cannot queue up acceptances past it; revoking an invitation frees its seat at once, and
an expired one frees itself. `PLAN_MAX_USERS` refuses **sign-up only**, never sign-in, so
setting it below the number of accounts you already have locks nobody out. An over-limit write
is a `403` whose JSON body carries `error: "Plan Limit Exceeded"` and a `planLimit` object with
the code (`PLAN_LIMIT_SEATS`, `PLAN_LIMIT_BOARDS`, `PLAN_LIMIT_WORKSPACES`, `PLAN_LIMIT_USERS`),
the limit and the current count. One workspace can be given ceilings of its own in the
`Workspace.planLimits` JSON column, which overrides these key by key; the app never writes it
itself.

**Closing registration is a switch, not a ceiling.** `SIGNUP_ENABLED=false` refuses
`POST /auth/sign-up/email` with a `403` whose JSON body carries `error: "Sign-up Disabled"`,
whatever the account count is; unset or `true` keeps registration open, which is how every
install ran before the switch existed. Like `PLAN_MAX_USERS` it refuses **sign-up only**:
signing in, verifying an address and everything else under `/auth` stay open, so closing it
never locks out the people already on the instance. `GET /config` publishes it as
`signUpEnabled`, but that document requires a session: it is there for the signed-in screens
that ask before offering something, and a signed-out register page learns the answer from the
`403` its own submit receives instead. Prefer the switch to pinning `PLAN_MAX_USERS` at your
current head count, which blocks your own invitees too and drifts the moment an account is
deleted. There is no invite-only mode yet: an invited address still needs the door open to
create its account, so until that lands, open it for the invitee and close it again. The
switch is independent of `DEMO_MODE` ([Demo instance](#demo-instance)), which keeps
registration open.

**Trello import needs no line here either.** `TRELLO_IMPORT_MAX_BYTES` (default `20971520`,
20 MiB) is the largest board export the importer will accept, and the bundled Compose file
already passes it. Three things about it are worth knowing before you touch it. It is a
**memory** ceiling, not a disk one: the upload is buffered and then `JSON.parse`d, and the parsed
object graph is a multiple of the bytes that produced it — so raising this raises the API's peak
heap by a multiple of the difference, not by the difference. It is **unrelated to
`ATTACHMENT_MAX_BYTES`**, which is why it is a second variable rather than a reuse of the first.
And it must stay **below the proxy's body limit** (26 MiB in the bundled `docker/Caddyfile`) with
room for the multipart envelope, for exactly the reason the attachment limit does — see
[the proxy contract below](#bringing-your-own-reverse-proxy). Importing works on an instance with
no `STORAGE_PATH` at all: an import creates link attachments, which store no bytes.

Two more variables cap the _shape_ of the board rather than the bytes of the export:
`TRELLO_IMPORT_MAX_CARDS` (default `50000`) and `TRELLO_IMPORT_MAX_LISTS` (default `5000`) refuse
an export that carries more cards or lists than that, with a `400` and nothing written, before a
single row is planned. `TRELLO_IMPORT_MAX_BYTES` alone does not bound this: a small card is a few
dozen bytes, so an export well under the byte ceiling can still be far more rows than any board
this import is meant to hold. Every name, description and URL the importer writes is also clamped
to the same ceiling its own write path enforces everywhere else: a task title, a board name, a
column name and so on each keep the same limit `CreateTaskDto`, `CreateBoardDto` and the other
DTOs already apply on every other route; a card whose title had to be cut still imports, and the
import report counts it as one of the rows that came across changed. The full list of clamped
fields and their ceilings is in
[ADR 0025's amendment](decisions/0025-trello-import-mapping.md#amendment-2026-08-26-field-length-ceilings-and-a-row-cap-sec-04),
not repeated here.

## 3. Start it

```bash
docker compose pull
docker compose up -d
docker compose ps -a     # see below for what "right" looks like
```

`ps -a`, not a plain `ps`: `migrate` is a one-shot job that has already exited by the time you
look, and a plain `ps` lists running containers only, so it omits the row you most want to
check. A healthy stack reads like this:

```
api        Up 27 seconds (healthy)
backup     Up 28 seconds (health: starting)
migrate    Exited (0) 27 seconds ago
postgres   Up 34 seconds (healthy)
proxy      Up 16 seconds
redis      Up 34 seconds (healthy)
web        Up 22 seconds (healthy)
```

`Exited (0)` on `migrate` is success — migrations applied, job done. A non-zero exit there is
the one to chase (`docker compose logs migrate`), and `api` will not have started at all.
`proxy` shows no `(healthy)` at all because it declares no healthcheck. `backup` does declare
one — it watches for a fresh dump in `/backups` — but its `start_period` is generous (10
minutes) so a database still taking its first `pg_dump` reads as `(health: starting)`, not
unhealthy; give it time and check again with `docker compose ps backup`.

The first request to `https://kurul.example.com` may take a few seconds while Caddy
completes the ACME challenge. Watch it happen if it does not:

```bash
docker compose logs -f proxy
```

Open the site, create the first account, and create a workspace. The first account is a normal
account — Kurul has no separate installer or admin bootstrap step.

## 4. Check it actually works

```bash
curl -sI https://kurul.example.com | head -1          # 307 → /login
curl -s  https://kurul.example.com/api/health/ready   # {"status":"ok", …}
```

Then, in the browser, open a board and drag a card. If the card moves for a second browser
window without a refresh, the realtime WebSocket is connected through the proxy — which is the
one part of the stack a naive reverse-proxy configuration tends to break silently.

Last, check the thing HTTPS was actually for. Sign in and look at the cookie you get back:

```bash
curl -si https://kurul.example.com/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"<your password>"}' | grep -i '^set-cookie'
```

You want to see the name prefixed and the attribute present:

```
set-cookie: __Secure-better-auth.session_token=…; Path=/; HttpOnly; Secure; SameSite=Lax
```

`Secure` means the browser will refuse to send that token over plain HTTP, and `__Secure-`
means it will refuse to _accept_ the cookie at all unless the connection was HTTPS. Neither is
a setting you turn on: Better Auth derives both from the scheme of the URL it is configured
with, which `docker-compose.yml` takes from `SITE_URL`. That makes the scheme in `SITE_URL` the
single switch that decides whether session tokens are protected in transit — with
`SITE_URL=http://…` the same request answers `set-cookie: better-auth.session_token=…;
HttpOnly; SameSite=Lax`, no prefix and no `Secure`, and the session token crosses the network in
clear text on every request. If you see the unprefixed form on a domain you believe is HTTPS,
`SITE_URL` still has `http://` in it; fix it and `docker compose up -d`.

### Calling the API from a script

A script, a CI job or a backup check does not want a cookie. Open Settings, create a personal
access token under "Personal access tokens", copy it (it is shown once), and send it as a
Bearer header against the workspace it was created in:

```bash
curl -s https://kurul.example.com/api/workspaces/<workspaceId>/boards \
  -H 'Authorization: Bearer kurul_pat_...'
```

The token acts as you, in that one workspace, with whatever role you hold when the request
arrives; revoking it from the same screen stops it immediately, and the workspace activity
feed records both the creation and the revocation. What it can and cannot call, and why, is in
[api-conventions.md](api-conventions.md#authentication). The same HTTPS argument applies twice
over here: a token crosses the network on every request, so never use one against an
`http://` `SITE_URL`.

## 5. Point a monitor at it

This is a step of the deployment, not an optional extra, and it is the last one because it is
the first one that needs a running instance to watch. `restart: unless-stopped` brings a crashed
container back; nothing in this stack tells you when the host is down, the disk filled, or
Postgres stopped accepting connections. An external monitor is the only signal that survives the
machine it is watching.

Monitor this URL:

```
https://kurul.example.com/api/health/ready
```

Two details in that URL are easy to get wrong, and both fail quietly.

**The `/api` prefix is required.** `/health/ready` without it is not the API — it matches the
proxy's catch-all rule and lands on the web app, which answers `307` and redirects to `/login`.
A monitor configured that way is red forever on a healthy instance, and if you widen its
accepted status codes to stop the noise it becomes green forever instead, including during an
outage.

**`/health/ready`, not `/health`.** `/health` is a liveness probe: it answers `200` as long as
Node is alive, deliberately including while the database is unreachable, because restarting the
process cannot heal a database. `/health/ready` is the one that goes red when the product is
actually broken, and its body names the dependency that failed:

```json
{ "status": "error", "checks": { "database": "down", "redis": "up" } }
```

The full parameter list — 5-minute interval, 2 consecutive failures before alerting, accept only
`200`, 10-second timeout, e-mail contact with the "back up" notification enabled — is in
[Uptime monitoring](development.md#uptime-monitoring--set-this-up-it-is-the-one-that-catches-an-outage),
along with the push-based alternative for an instance that is not reachable from the internet.

**Also watch backup freshness — `/api/health/ready` does not cover it.** The `backup` sidecar
can stop producing dumps (a `pg_dump` that keeps failing, a volume that filled up) without ever
touching the database connection the API's readiness probe checks, so that endpoint stays green
through the whole outage. `backup`'s own Docker healthcheck is the signal instead: unhealthy
means the newest `/backups/kurul-*.dump` is older than `2 × BACKUP_INTERVAL` (48 hours on the
default 24h interval), which is the point at which the API's own retention sweep can no longer
assume a recent dump exists to fall back on. Point your monitor's container-health check (most
uptime tools that support Docker, or a cron `docker inspect` on the host) at it, or at minimum
check it by hand periodically:

```bash
docker compose ps backup                                        # "(healthy)" or "(unhealthy)"
docker inspect --format '{{.State.Health.Status}}' kurul-backup-1
```

An `(unhealthy)` `backup` does not need a restart — `restart: unless-stopped` does not act on
health status, so the sidecar keeps running and retrying on its own — it needs
`docker compose logs backup` read, because something (usually a failing `pg_dump`) is actually
wrong and the next scheduled cycle inherits the same problem until that's fixed.

Then fire it once on purpose, because an alerting setup that has never fired is a hypothesis:

```bash
docker compose stop postgres
curl -s https://kurul.example.com/api/health/ready   # 503, "database":"down"
# wait two intervals, expect the red alert
docker compose start postgres
curl -s https://kurul.example.com/api/health/ready   # 200, "database":"up"
# expect the recovery mail
```

`/health/ready` returning `503` while `/health` stays `200` during that window is the correct
behaviour, not a bug — it is the difference the two endpoints exist to express.

## Email (SMTP)

Invitations are the one feature that hard-fails without SMTP: accepting an invitation requires
a verified email address, and verification needs a delivered message
([ADR 0013](decisions/0013-invitation-email-verification.md)). With `SMTP_HOST` unset the API
still boots and logs the message instead of sending it, so a solo install works fine — but
nobody can join your workspace. The Members screen says so in the product, too. Notification
email (assignment, mention, due-soon) uses the same settings and simply stays off without
them; once SMTP works, each user can switch it off for themselves under Settings.

**Password reset needs SMTP too, and fails quietly without it.** `POST /auth/request-password-reset`
answers `200` whatever happens (it answers the same for an address that has no account, so
nobody can enumerate accounts with it), and with `SMTP_HOST` unset the whole message, reset
link included, goes to the API log instead of to the person:

```
Email not sent (no SMTP): from=Kurul <noreply@localhost> to=you@example.com subject=Reset your Kurul password
...
http://localhost:4000/auth/reset-password/<token>?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Freset-password
```

That is workable on a solo install (copy the link out of `docker compose logs api` within the
hour it is valid) and is not a recovery path for anyone else, because a locked-out user cannot
read your logs. On a `DEMO_MODE` instance no reset mail is written even to the log for the demo
account itself, whose password is published anyway.

Any SMTP provider works. Two things go wrong most often:

- **`SMTP_SECURE`.** `true` means implicit TLS, which is port 465 only. Port 587 and 25 use
  STARTTLS and need `false`. Setting `true` on 587 hangs the connection.
- **`MAIL_FROM` must be an address the provider lets you send as.** Most providers reject a
  `From:` that does not match the authenticated account or a verified domain, and the rejection
  looks like "invitations do nothing" rather than an error in the UI.

Send yourself an invitation as the test. If nothing arrives:

```bash
docker compose logs api | grep -i mail
```

## Backups

The `backup` service is already running: every `BACKUP_INTERVAL` seconds (24h by default) it
writes **two** archives into the `backup_data` volume — a `pg_dump` of the database and a
`.tar.gz` of the uploaded attachment files — and keeps `BACKUP_KEEP` of each series. Both
archives of one cycle carry the **same timestamp**, which is how a restore knows which tar
belongs to which dump. `BACKUP_KEEP` is a count, not an age, and a restart does not spend one:
the sidecar skips its boot-time cycle while a dump younger than half of `BACKUP_INTERVAL`
exists, so a reboot or a `docker compose up` after a `.env` edit leaves the history you had
([the scheduled backup sidecar](development.md#the-scheduled-backup-sidecar)).

That covers "I deleted the wrong workspace". It does not cover a dead disk — the archives sit
on the same host as the database. Copy them off the machine, **both halves of the newest
cycle**, not just the dump:

```bash
docker run --rm -v kurul_backup_data:/backups -v "$PWD:/out" alpine \
  sh -c 'stamp=$(ls -t /backups/*.dump | head -1 | sed "s|.*/kurul-||;s|\.dump$||"); \
         cp /backups/kurul-$stamp.dump /out/; \
         cp /backups/kurul-$stamp-files.tar.gz /out/ 2>/dev/null || true'
```

A dump restored without its file archive brings every row back and leaves every uploaded file
behind — and passes every verification step that was written before attachments existed. The
drill in [Restoring from a backup](development.md#restoring-from-a-backup) checks the files too.

Restore steps are in [Upgrading and backups](development.md#upgrading-and-backups).

### Off-host copies

Better than remembering to run that command: give the sidecar a remote and it pushes both
archives itself, every cycle. Set `BACKUP_REMOTE` in `.env` to an
[rclone](https://rclone.org/) remote path and each cycle then also uploads the pair, prunes the
remote to the same `BACKUP_KEEP`, and records that it worked. **Leave `BACKUP_REMOTE` blank and
nothing changes**, including the healthcheck: this is opt-in, and an install that never sets it
runs exactly the loop described above.

| Variable                     | Default | Purpose                                                                                           |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `BACKUP_REMOTE`              | blank   | rclone remote path, e.g. `s3:my-bucket/kurul`. Blank turns the whole off-host half off            |
| `RCLONE_CONFIG_<NAME>_<KEY>` | -       | rclone's own env-var config, in `rclone.env` beside `docker-compose.yml`. `<NAME>` is your remote |
| `RCLONE_CONFIG`              | -       | Path to a mounted `rclone.conf`, if you would rather keep credentials in a file than in env vars  |

The credentials do **not** go in `.env`: rclone's env keys are named after your remote, so no
fixed list of them can be declared in `docker-compose.yml`, and the `backup` service reads an
optional `rclone.env` next to the compose file instead. That file is read by this one container
only. `.env` is not read by any container either: Compose uses it for `${VAR}` interpolation and
forwards an explicit list of keys to each service. For every setting the API reads, that list is
the `environment:` block of the `api` service in [`docker-compose.yml`](../docker-compose.yml),
and a key that is not in that block never reaches the API however it is set in `.env`. Create
`rclone.env` with `chmod 600` and keep it out of git (`.gitignore` already lists it).

An S3 example, end to end. `KURULOFF` is an arbitrary remote name; it just has to match the one
in `BACKUP_REMOTE`:

```bash
# rclone.env, next to docker-compose.yml, chmod 600
RCLONE_CONFIG_KURULOFF_TYPE=s3
RCLONE_CONFIG_KURULOFF_PROVIDER=AWS
RCLONE_CONFIG_KURULOFF_ACCESS_KEY_ID=AKIA...
RCLONE_CONFIG_KURULOFF_SECRET_ACCESS_KEY=...
RCLONE_CONFIG_KURULOFF_REGION=eu-central-1
```

```bash
# .env
BACKUP_REMOTE=KURULOFF:my-backup-bucket/kurul
```

```bash
docker compose up -d backup
docker compose logs backup | grep off-host    # "pushed kurul-… to KURULOFF:…" per archive
```

Anything rclone speaks works the same way, with the same two lines: Backblaze B2
(`_TYPE=b2`), any S3-compatible endpoint including MinIO and Cloudflare R2
(`_TYPE=s3` plus `_ENDPOINT=`), SFTP (`_TYPE=sftp`), and so on. The key names are the config
keys from [rclone's docs](https://rclone.org/docs/#config-file) uppercased. To use a
`rclone.conf` file instead, mount it and point `RCLONE_CONFIG` at it (both lines in a
`docker-compose.override.yml`, so an upgrade that replaces `docker-compose.yml` keeps them):

```yaml
services:
  backup:
    volumes:
      - ./rclone.conf:/config/rclone.conf:ro
    environment:
      RCLONE_CONFIG: /config/rclone.conf
```

**rclone itself is downloaded on first use.** The sidecar runs a stock `postgres:18-alpine`
image, so with `BACKUP_REMOTE` set the script fetches one pinned rclone release (about 20 MB,
78 MB unpacked), checks it against a sha256 hard-coded in `scripts/backup.sh`, and caches it in
the backup volume so later cycles and restarts reuse it. An
`rclone` already on the container's `PATH` (your own image, a bind-mounted binary) is used
instead and nothing is downloaded, which is also the answer for an air-gapped host.

**The healthcheck follows the remote.** With `BACKUP_REMOTE` set, `docker compose ps` reports
this service healthy only while the newest **off-host** copy is under `2 × BACKUP_INTERVAL`
old, so credentials that expired, a bucket policy that changed, or a network that has been
down since Tuesday surface as an unhealthy container instead of as a surprise on restore day.
Local archives keep being written and kept throughout: a failed upload never deletes one, and
the `ERROR off-host:` line in the log says what failed.

To **restore from the remote**, fetch the pair back into the backup volume first, then follow
the ordinary [restore drill](development.md#restoring-from-a-backup) unchanged, which is the
point of the two copies being byte-identical:

```bash
docker compose exec backup /backups/.rclone/rclone --config= \
  lsf "$BACKUP_REMOTE"                 # pick a timestamp, both halves of it
docker compose exec backup /backups/.rclone/rclone --config= \
  copy "$BACKUP_REMOTE/kurul-<timestamp>.dump" /backups/
docker compose exec backup /backups/.rclone/rclone --config= \
  copy "$BACKUP_REMOTE/kurul-<timestamp>-files.tar.gz" /backups/
```

`/backups/.rclone/rclone` is the downloaded copy; if you supplied your own rclone, that is just
`rclone`, and `--config=` (which says "the config is env vars only") comes off when your
credentials live in a mounted `rclone.conf`.

If the host itself is gone, run those two `copy` commands from any machine with rclone and the
same credentials, and hand the archives to a fresh install's restore.

## Demo instance

This section is for one job: running a **public demo** that anyone can sign into and that
throws its contents away on a schedule. If you are self-hosting Kurul for your own team, skip
it. Nothing here is on by default and none of it changes an ordinary install: `.env.example`
ships `DEMO_MODE` and `DEMO_PASSWORD` blank, and blank is the ordinary install. Without the
profile, `docker compose up -d` neither starts the sidecar nor asks for either value.

Two things make a demo: `DEMO_MODE=true`, which changes how the API behaves, and the `demo`
compose profile, which starts the sidecar that does the wiping. Both, or neither.

```bash
# .env
DEMO_MODE=true
DEMO_PASSWORD=pick-something-and-publish-it   # at least 8 characters
DEMO_RESET_INTERVAL_MINUTES=60                # the default
POSTGRES_DB=kurul_demo                        # see "the two locks" below
REDIS_PASSWORD=...                            # recommended, see below
```

```bash
docker compose --profile demo up -d
```

The profile adds one container, `demo-reset`. It runs from the same `kurul-api` image as the
API, so there is nothing extra to build or pull.

### What `DEMO_MODE=true` changes

| Behaviour                                       | Why                                                                                                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A standing banner in the app naming the cadence | It is the only warning a visitor gets before an hour of their typing disappears. Dismissible for the browser tab, back on the next visit                                                 |
| All outbound email goes to the log              | Whatever `SMTP_HOST` says. A demo anyone can sign up to must not be able to send mail to an address a stranger typed in                                                                  |
| Account deletion and workspace deletion `403`   | The demo is one shared workspace. Deleting it, or the account that owns it, empties the demo for every other visitor until the next reset                                                |
| `POST /auth/change-password` `403`              | The demo account's password is published, so any visitor could rotate it and lock everyone else out until the next reset writes `DEMO_PASSWORD` back. Same envelope as the two deletions |
| `GET /config` publishes the reset schedule      | So the banner names the same cadence the sidecar sleeps for, rather than a number somebody typed twice                                                                                   |

Everything else is the product. Sign-up stays open (rate limits, not a switch, are the answer
to abuse there, and `DEMO_MODE` never reads `SIGNUP_ENABLED`), revoking sessions and renaming
the account stay open because both are a sign-in away from recovered, invitations can still be
created and their links copied by hand, and uploads are bounded by the ordinary attachment
quotas
([ADR 0027](decisions/0027-attachment-quotas.md)). Set those low on a demo host rather than
reaching for another switch.

### The account

The reset creates one account, `demo@kurul.dev`, with the password you put in `DEMO_PASSWORD`.
Publish both wherever you publish the demo link. There is no default password and there will
not be one: a default baked into an open-source image is the same password on every demo host
on the internet. Alongside it the dataset seeds a second person who has **no credentials at
all**: they exist so the boards have comments and assignments that are not all the visitor's
own, and there is no password for them to leak.

### The two locks on the reset

`node dist/demo/reset.js` deletes every row in the database before it writes anything. It
refuses to run unless **both** of these hold:

1. `DEMO_MODE=true` is set in its own environment, and
2. the database named in `DATABASE_URL` has `demo` in its name.

That is why `POSTGRES_DB=kurul_demo` is in the snippet above. Two independent checks, from two
different sources, so that pointing this at a real deployment takes two mistakes rather than
one. `kurul`, `kurul_prod` and `postgres` all refuse.

### Sessions, and the minute after a reset

A reset deletes every session, so everyone signed in is signed out. The app handles that: the
next navigation lands on the sign-in page with the page you were on kept as the return URL.

For up to 60 seconds after a reset, a browser that was mid-session can still be recognised from
its signed session cookie, which Kurul caches for that long to avoid a database read per
request. In that window reads come back empty and a write can fail. It clears itself, it is the
same window a deleted account has
([ADR 0026](decisions/0026-account-deletion-anonymisation.md)), and on a demo the cost is the
last thing somebody typed in the minute their hour ran out.

### Watching it

`docker compose ps` is the check that matters. `demo-reset` reports **unhealthy** once no reset
has succeeded for twice the interval, i.e. two missed cycles in a row, so one slow or skipped
run does not flap it. Without that, a reset loop that had stopped resetting would report as simply
"Up" while a launch-day link served whatever the last visitor left behind.

```bash
docker compose --profile demo logs demo-reset
```

Point an uptime monitor at `https://your-domain/api/health/ready` as well, per
[5. Point a monitor at it](#5-point-a-monitor-at-it). It is the same advice every install gets,
and it is the thing that tells you the demo is down before someone on the internet does.

### Also worth doing on a public demo

- **Set `REDIS_PASSWORD`.** It is optional everywhere else because Redis is not published
  outside the compose network. A host that strangers are pointed at is the one where the
  defence-in-depth is worth the one line.
- **Keep the attachment quotas low.** `ATTACHMENT_WORKSPACE_QUOTA_BYTES` and
  `ATTACHMENT_INSTANCE_QUOTA_BYTES` are what bound how much a demo can be made to store between
  resets; the reset deletes the rows, and the nightly sweep reclaims the bytes.
- **Do not put anything real in it.** It is not a staging environment. It is a database that is
  emptied every hour by a container that is designed to empty it.

## Upgrading

A release is images plus files. `docker compose pull` refreshes the images and nothing else, so
an install that only ever pulls keeps running the `docker-compose.yml`, `docker/Caddyfile` and
`scripts/backup.sh` it was installed with, and every later release that added a service (the
`demo` profile's `demo-reset`), a variable compose forwards (`BACKUP_REMOTE`, the attachment
quotas) or a Caddy rule quietly does not reach it. The runbook re-fetches the files for that
reason. Do the steps in this order, every time; none of them is long.

1. **Read the release.** The [CHANGELOG](../CHANGELOG.md) section for the target version
   carries every breaking change and every migration note, and
   [Release notes for operators](#release-notes-for-operators) below points at the ones that
   ask something of you before `pull`.
2. **Take a backup now, and copy it off the host.** The sidecar's last cycle may be a day old;
   this one is from right before the upgrade, which is the recovery point a rollback wants:

   ```bash
   docker compose exec backup /bin/sh /usr/local/bin/backup.sh once
   ```

   Then copy the pair out of the volume with the command in [Backups](#backups), or, with
   `BACKUP_REMOTE` set, confirm the two `off-host: pushed` lines in
   `docker compose logs backup`. Why both halves, and the by-hand variant that survives a
   `docker compose down -v`: [Taking a dump by hand](development.md#taking-a-dump-by-hand).

3. **Re-fetch the files at the new tag.** Run the `curl` lines from
   [step 2 of the install](#2-fetch-the-compose-file-and-configure) again with the new version
   in each URL, all except the `.env` one: `.env` is yours and stays. The other three files are
   replaced outright, which is why a local change belongs in `.env` or in a
   `docker-compose.override.yml` (as the [`rclone.conf` mount](#off-host-copies) and
   [`TRUST_PROXY`](#bringing-your-own-reverse-proxy) already do) rather than in the files
   themselves. `diff` the new compose file against the old one if you want to see what the
   release changed before it runs.
4. **Set `TAG`** in `.env` to the new version, the same string as in the URLs.
5. **Pull and start:**

   ```bash
   docker compose pull
   docker compose up -d --wait
   ```

   Migrations run automatically: the one-shot `migrate` service applies them before `api`
   starts, and `--wait` returns once every long-running service reports healthy, non-zero if
   one does not.

   A recreate is a pause, not an outage. `api` is given 30s (`stop_grace_period`) to finish
   what it was doing before Docker kills it, and the bundled Caddy holds a request for up to
   30s while an upstream is coming back instead of answering 502, retrying every 500ms. One
   replica still means requests wait rather than being served elsewhere, and an upload already
   streaming its body is not retried. A replacement reverse proxy needs its own equivalent to
   behave the same way, and nginx open source has no one-to-one match: `proxy_next_upstream`
   hands the request to the _next_ server in the upstream group, so a group with a single
   `api` entry is never retried.

6. **Verify:**

   ```bash
   docker compose ps -a                          # migrate: Exited (0); the rest healthy
   curl -fsS https://kurul.example.com/api/health/ready
   ```

   `-a`, or the one-shot `migrate` row is hidden. Then open the site and sign in once.

7. **If it went wrong:** [Rollback](development.md#rollback) covers moving the images back to
   the previous tag and when that alone is enough;
   [Restoring from a backup](development.md#restoring-from-a-backup) is the drill for the
   archive you took in step 2. Neither is repeated here on purpose: the steps are the same
   whether an upgrade or anything else went wrong.

Pin a release with `TAG=v0.4.0` in `.env` rather than tracking `latest`: an upgrade should be
a step you take deliberately, with the backup from step 2 in hand, not something the next
`docker compose up` does to you.

### Release notes for operators

What a release changes in the files this page has you fetch, or expects of you before `pull`.
The full entries live in `CHANGELOG.md`; this list only points at them.

- **Next release ([Unreleased](../CHANGELOG.md#unreleased)):** Better Auth 1.7.1 ships a
  migration the `migrate` service applies on the first `up`; nothing to run, but the backup in
  step 2 is what covers it. `BACKUP_REMOTE` and the off-host copy need the `scripts/backup.sh`
  and `docker-compose.yml` from step 3 (v0.3.0's script ignores the variable without an
  error); setup in [Off-host copies](#off-host-copies). `TRUST_PROXY` is now read from `.env`
  with a default of `1`: delete a `TRUST_PROXY=false` line an older `.env.example` left in your
  `.env`, or the API behind Caddy stops seeing client addresses
  ([details](#bringing-your-own-reverse-proxy)).
- **0.3.0 ([CHANGELOG](../CHANGELOG.md#030---2026-08-22)):** attachment quotas gained
  defaults; check your usage before upgrading, see
  [Attachment quotas now have defaults](#attachment-quotas-now-have-defaults) below. Also the
  first release that publishes `kurul-migrate`, so the first one this page's `curl` install
  works on.

### Attachment quotas now have defaults

`v0.3.0` and later cap attachment storage at 2 GiB per workspace and 20 GiB per instance
when `ATTACHMENT_WORKSPACE_QUOTA_BYTES` / `ATTACHMENT_INSTANCE_QUOTA_BYTES` are unset (they
used to mean unlimited). **A workspace already holding more than 2 GiB of files will get a
`413` on its next upload** unless you set a higher number, or `0` for unlimited, before you
upgrade. One query says where you stand; the first line is the instance, the second is per
workspace:

```bash
docker compose exec postgres psql -U kurul -d kurul -c \
  "SELECT COALESCE(SUM(size), 0) AS instance_bytes FROM \"Attachment\" WHERE kind = 'FILE';"
docker compose exec postgres psql -U kurul -d kurul -c \
  "SELECT w.slug, SUM(a.size) AS bytes FROM \"Attachment\" a JOIN \"Task\" t ON t.id = a.\"taskId\" JOIN \"Board\" b ON b.id = t.\"boardId\" JOIN \"Workspace\" w ON w.id = b.\"workspaceId\" WHERE a.kind = 'FILE' GROUP BY w.slug ORDER BY bytes DESC;"
```

Compare the numbers against `2147483648` and `21474836480`. The same upgrade adds a per-IP
upload byte budget (`ATTACHMENT_UPLOAD_BYTES_PER_MINUTE`, 256 MiB a minute by default), which
only matters to a client that uploads more than ten max-size files a minute from one address.

### Coming from Kurultay (v0.1.0)

The project was renamed before v0.2.0, and the rename reaches further than the label on the
README: the Postgres role and database are now `kurul`, the published images are
`ghcr.io/dravcore/kurul-api` and `-web`, and Compose derives its volume prefix from the install
directory, which the instructions above now call `/opt/kurul`. An existing v0.1.0 install does
not pick any of that up on its own, and `docker compose pull` against the old image names will
simply keep serving you the old ones.

**There is no in-place upgrade path that renames a running database for you.** Do it in this
order, with the stack down, and take the backup first — this is the one upgrade in this
project's history that touches identifiers rather than schema.

```bash
cd /opt/kurultay
docker compose exec postgres pg_dump -U kurultay -Fc kurultay > /tmp/kurul-migration.dump
docker compose down                     # NOT -v: the volumes are what you are keeping
```

Then rename the directory and take the release's files, at the tag you are moving to, with the
`curl` lines from [step 2 of the install](#2-fetch-the-compose-file-and-configure) (all but the
`.env` one; yours stays):

```bash
cd /opt && mv kurultay kurul && cd kurul
curl -fsSLO https://raw.githubusercontent.com/dravcore/kurul/v0.4.0/docker-compose.yml
# then docker/Caddyfile and scripts/backup.sh the same way
```

Edit `.env`: `POSTGRES_USER` and `POSTGRES_DB` become `kurul`, and the `DATABASE_URL`
credentials and database segment change with them. Then create the new role and database
against the volume you kept, and restore into it:

```bash
docker compose up -d postgres
docker compose exec -T postgres psql -U kurultay -d kurultay   -c "CREATE ROLE kurul LOGIN PASSWORD '<your POSTGRES_PASSWORD>';"   -c 'CREATE DATABASE kurul OWNER kurul;'
docker compose exec -T postgres pg_restore -U kurul -d kurul --no-owner < /tmp/kurul-migration.dump
docker compose up -d
curl -s https://your.domain/api/health/ready
```

The old role and database can be dropped once the new stack has served real traffic for a day.
Keep the dump until then; it is the only copy that predates the rename.

**Renaming the directory is what moves the volumes**, because Compose namespaces them by
project name — `kurultay_postgres_data` becomes `kurul_postgres_data`. If you would rather not
move them, set `COMPOSE_PROJECT_NAME=kurultay` in `.env` and the old volumes keep being used
under their old names. That is supported and slightly confusing; either is fine, as long as you
pick one deliberately.

## Verifying what you pulled

`docker compose pull` trusts whatever ghcr.io hands it. Two things published with every release
let you stop doing that: a **signature** that says this image came out of this repository's
release workflow, and an **SBOM** that says what is inside it. Both are optional to use and
neither protects anyone who never runs the commands below.

The base images underneath the stack, `postgres`, `redis` and `caddy` in `docker-compose.yml`
and `node` in the api and web Dockerfiles, are pinned `tag@sha256:...` instead of a bare tag for
a related reason: two builds of the same release then resolve the same bytes. Two separate
Dependabot ecosystems keep each digest current: `docker-compose` bumps `postgres`, `redis` and
`caddy` in the compose files, and `docker` bumps `node` in the two Dockerfiles; either way an
upstream fix arrives as a reviewable pull request instead of silently, the next time something
happens to rebuild. One side effect: `docker compose pull` on its own no longer picks up an
upstream `postgres`/`redis`/`caddy` patch release between Kurul releases, since the tag it
resolves is now fixed to a digest; that patch arrives with the next Kurul release that merges
the Dependabot bump, not before.

### Checking the signature

You need [cosign](https://github.com/sigstore/cosign) **3.0 or newer** — the signatures are
written in the Sigstore bundle format that cosign 3 uses by default, and cosign 2 cannot read
them.

```bash
cosign verify \
  --certificate-identity "https://github.com/dravcore/kurul/.github/workflows/release-images.yml@refs/tags/v0.4.0" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  ghcr.io/dravcore/kurul-api:v0.4.0
```

Repeat it for `kurul-web` and `kurul-migrate`, which are signed the same way, and replace
`v0.4.0` in both places when you verify another release. The version appears twice for two different reasons:
once as the git ref the signing workflow ran on, and once as the image tag you are asking
about.

**The two `--certificate-*` flags are the entire check; do not drop them.** There is no signing
key to guard here. The images are signed keylessly: the release workflow trades a GitHub OIDC
token for a certificate valid for a few minutes, signs, and the certificate expires. What makes
the result meaningful is not that a secret was kept, it is that the certificate records _which
workflow, in which repository, at which git ref_ asked for it. Without `--certificate-identity`
cosign will happily accept a validly-signed image from anybody at all — including someone who
pushed a tag to their own fork of this repository.

A successful run prints the checks it performed and a JSON claim naming the digest it verified:

```
Verification for ghcr.io/dravcore/kurul-api:v0.4.0 --
The following checks were performed on each of these signatures:
  - The cosign claims were validated
  - Existence of the claims in the transparency log was verified offline
  - The code-signing certificate was verified using trusted certificate authority certificates
```

Anything else is a failure, and the two failures worth telling apart are `no signatures found`
(this image was never signed — it predates this feature, or it is not the image you think it is)
and `no matching CertificateIdentity found` (it _was_ signed, by someone or something other than
the identity you asked for; the error prints the identity it actually found).

Verification reaches out to Sigstore's public infrastructure for the trust root and the
transparency log, so it wants outbound HTTPS. Run it from your laptop before you deploy if the
server has none.

Both the tag and the digest work as the last argument, and on a host that has already pulled,
the digest is the stricter question — it asks about the exact bytes on disk rather than about
whatever the tag points at now:

```bash
docker image inspect ghcr.io/dravcore/kurul-api:v0.4.0 --format '{{index .RepoDigests 0}}'
```

### Where the SBOM lives

On the [GitHub Release](https://github.com/dravcore/kurul/releases) for the version, as
downloadable assets — one per image per architecture, because the two architectures genuinely
do not contain the same packages:

```
kurul-api-v0.4.0-linux-amd64.spdx.json
kurul-api-v0.4.0-linux-arm64.spdx.json
kurul-web-v0.4.0-linux-amd64.spdx.json
kurul-web-v0.4.0-linux-arm64.spdx.json
kurul-migrate-v0.4.0-linux-amd64.spdx.json
kurul-migrate-v0.4.0-linux-arm64.spdx.json
```

The format is SPDX 2.3 JSON, which is what `grype`, `trivy` and Dependency-Track all read
without conversion:

```bash
gh release download v0.4.0 --repo dravcore/kurul --pattern '*.spdx.json'
grype sbom:./kurul-api-v0.4.0-linux-amd64.spdx.json
```

**The SBOM file itself is not signed** — the signature above covers the image, and the SBOM is a
description of it produced by the same workflow run. For most people that is enough, because a
tampered SBOM cannot make a tampered image verify. If you need the stronger property, do not
trust the file: regenerate it yourself from the image you have already verified, with
[syft](https://github.com/anchore/syft), and compare.

```bash
syft scan registry:ghcr.io/dravcore/kurul-api:v0.4.0 --platform linux/amd64 -o spdx-json
```

## Bringing your own reverse proxy

If you already run nginx, Traefik or another proxy and would rather not stack a second one,
you can replace the `proxy` service — but the routing contract is not negotiable, because the
web app is built against it. Three rules, in this order, all on one hostname:

| Path       | Goes to  | Prefix              | Max request body              |
| ---------- | -------- | ------------------- | ----------------------------- |
| `/auth/*`  | api:4000 | kept as-is          | **64 KiB** (`65536` bytes)    |
| `/api/*`   | api:4000 | `/api` **stripped** | **26 MiB** (`27262976` bytes) |
| everything | web:3000 | kept as-is          | proxy default is fine         |

`/api/*` must also pass WebSocket upgrades through — that is the realtime board feed.

**One route carries a secret in its path, so keep it out of the proxy's access log.**
`GET /auth/reset-password/<token>` is a URL a real browser follows, and the token in it is live
until the form on the other side is submitted. The API's own access log writes that path as
`/auth/reset-password/:token` and never the token itself
(`apps/api/src/common/logging/access-log.middleware.ts`), but a proxy in front logs the URL it
was asked for. The bundled `docker/Caddyfile` configures no `log` directive and so writes no
access log at all; nginx's default `combined` format logs `$request`, which is the whole URL. If
you keep an access log on this hostname, filter or rewrite `/auth/reset-password/*` in it, and
until you do, treat that log as something that holds live credentials.

One thing outside the routing contract is worth reproducing anyway: the bundled Caddy holds a
request for up to 30s while an upstream is restarting instead of answering 502, which is what
turns an upgrade into latency rather than errors. A proxy without it is still correct, only
noisier on every `docker compose up -d`. What it takes to match, and why nginx open source has
no one-to-one equivalent, is in step 5 of [Upgrading](#upgrading).

#### Why the proxy's number is 26 MiB and the API's is 25

**This is not a typo and the two must not be made equal.** The largest _attachment_ this
instance accepts is `ATTACHMENT_MAX_BYTES`, 25 MiB — that is the number to quote to users and
the only one to change when you want a different limit. The proxy's 26 MiB is a ceiling above
it, not a second copy of it.

They differ because they count different things. `client_max_body_size` (and Caddy's
`request_body max_size`) counts the **whole request body**; `ATTACHMENT_MAX_BYTES` counts the
**file** inside it. An upload wraps the file in a multipart envelope — a boundary line and a
`Content-Disposition` header per part, plus the closing boundary — which adds to the body on top
of the file's own bytes. Measured against the real request this API receives, that envelope is
309 bytes for a short filename and 563 bytes for a 255-character one.

So a proxy set to exactly 25 MiB rejects a 25 MiB attachment: the file is within the documented
limit, the body is not. The user gets a `413` on a file the documentation says is allowed, and
the number they are pointed at is the one that is not the problem.

The rule the two layers actually follow is an ordering, not an equality:

> **The proxy must never reject something the API would accept.** The proxy's job is to cut
> absurd bodies before anything buffers them. The exact file limit belongs to the API — the only
> layer that can answer with _which_ file was too big.

**A second body crosses the same proxy: the Trello import.** `TRELLO_IMPORT_MAX_BYTES` (20 MiB)
sits under the same ordering rule and under the same 26 MiB proxy ceiling, with more headroom
because it is a smaller number. The relationship checked between the two is an **inequality**, not
the equality-plus-envelope the attachment limit is held to — the import limit only has to stay
below the proxy's, not track it — so raising `TRELLO_IMPORT_MAX_BYTES` past the proxy's number
gives you an import the proxy kills with an empty-bodied `413` the API never sees.
`apps/api/src/storage/two-layer-limit.spec.ts` fails the build if either relationship stops
holding.

So: raise `ATTACHMENT_MAX_BYTES` and you must raise the proxy's number to stay above it (1 MiB
of headroom is what the bundled config ships and is ~1860x the largest envelope measured).
Lower the proxy's below the API's and every upload near the limit fails with a `413` the API
never sees and never logs. Caddy imposes no body limit of its own, which is why the bundled
`docker/Caddyfile` has to set one explicitly — and nginx defaults `client_max_body_size` to
**1 MB**, so a replacement proxy that omits the row rejects every attachment larger than a
megabyte.

#### Why `/auth/*` has a ceiling of its own, and why it is 64 KiB

Rule 1 carries a limit too, and a much smaller one. Better Auth reads the raw request stream
itself, below the parsers that enforce `REQUEST_BODY_MAX_BYTES` on every other route, so that
ceiling never applied to `/auth/*`: a `POST /auth/sign-in/email` was read to completion at any
size, and the built-in attempt budget (3 per 10 seconds per IP and path on sign-in, sign-up and
change-password, 100 per minute on the other auth routes) counts requests, not bytes. Every body
those routes take is a JSON object of a few hundred bytes, so 64 KiB is two orders of magnitude
of headroom.

The API enforces the same number as `AUTH_BODY_MAX_BYTES` (`65536`, a constant in
`apps/api/src/auth/auth-body-limit.ts`, not an environment variable): a request that declares a
`Content-Length` above it is answered with the `Request body is too large` `413` envelope before
a byte of the body is read. Here the proxy and the API **may be equal**, unlike the pair above:
an auth body has no multipart envelope, both layers count the same bytes, and the ordering rule
holds at equality.

A body sent without a `Content-Length` (chunked transfer encoding, which a browser never uses
for a JSON string body) is the one case the two layers answer differently. The proxy is the
layer that bounds it with a status: `request_body max_size` cuts the body at the same 64 KiB.
The API cannot answer a body it is already streaming to Better Auth, so it counts the bytes as
they arrive and closes the connection past the ceiling, which keeps an instance exposed without
a proxy bounded too, but as a dropped connection rather than a `413`. That is one more reason
the proxy is part of the default stack rather than an optional extra.
`apps/api/src/storage/two-layer-limit.spec.ts` pins the Caddyfile figure, the nginx row below
and the API constant to each other.

### Telling the 413s apart

Both layers answer an oversized upload with `413` — and so does a third limit that has nothing
to do with uploads. **The response body is what says which one did it**:

| What you get back                                  | Who rejected it | What it means                                                    |
| -------------------------------------------------- | --------------- | ---------------------------------------------------------------- |
| `413` with a **JSON** body carrying `statusCode`   | the API         | working as designed — the file is over `ATTACHMENT_MAX_BYTES`    |
| `413` with an **empty** body (`Content-Length: 0`) | the proxy       | the body was over the proxy's ceiling, which is the coarse cut   |
| `413` JSON reading `Request body is too large`     | the API         | not an upload at all — a JSON body over `REQUEST_BODY_MAX_BYTES` |
| `413` JSON, `error: "Attachment Quota Exceeded"`   | the API         | the file fits, the storage doesn't — a quota is full (see above) |

The first row is the normal answer for an oversized attachment, and the one a user can act on:
it names the limit. The second is the proxy refusing a body before the API ever saw it — correct
for something absurd, but if a user hits it on a file **under** `ATTACHMENT_MAX_BYTES` then your
proxy's ceiling is too low (see "Why the proxy's number is 26 MiB and the API's is 25" above).

The third row is a different limit that happens to share the status code: `REQUEST_BODY_MAX_BYTES`
(default `1048576`, 1 MiB) caps the **JSON and form-encoded** bodies every other endpoint takes,
and no attachment ever passes through it. The same sentence under a `path` starting with `/auth/`
is the smaller `AUTH_BODY_MAX_BYTES` (64 KiB) instead; see rule 1 above. If you see either,
nothing about your storage or your proxy is misconfigured: some request simply sent more JSON
than the API accepts.

The fourth row is a different failure again: the file is under `ATTACHMENT_MAX_BYTES`, but storing
it would push a workspace or the instance over its quota. See "Attachment storage is unbounded
until you cap it, and it shares Postgres's disk" above for sizing `ATTACHMENT_WORKSPACE_QUOTA_BYTES`
and `ATTACHMENT_INSTANCE_QUOTA_BYTES`.

There is a fifth, and only one endpoint can produce it: a `413` on
`POST /workspaces/…/imports/trello` is `TRELLO_IMPORT_MAX_BYTES` (20 MiB), not any of the four
above. The route in the response envelope's `path` is what tells it apart. If a user hits it on an
export **under** 20 MiB, the proxy cut the body first and the ceiling to look at is the proxy's.

The headers do not help — Caddy's `413` carries no `Server` header, so only the body
distinguishes them. Everything the API itself rejects comes back as
`Content-Type: application/json; charset=utf-8` with a `{"statusCode":…,"error":…,"path":…,
"requestId":…}` envelope; the proxy's rejection carries no body at all.

**The proxy does not log this rejection.** `docker/Caddyfile` has no `log` directive — the API
already logs every request that reaches it, and access logs on both layers would double every
deployment's log volume for one size check — so a body rejected by the proxy appears in
`docker compose logs proxy` **not at all**. An empty `413` with nothing in the proxy log is the
expected result, not evidence that the limit is broken.

Measured on `docker/Caddyfile` against `caddy:2-alpine`, with the limit it carried at the time
(`25MiB`): exactly `26214400` bytes of body → `200`, one byte more → `413`, with `curl` exiting
`0` on a well-formed status line — the connection is closed properly rather than cut mid-upload.
That is what established the threshold is `> max_size` rather than `>=`, and it is also what
showed the limit had to move: a 26214400-byte _file_ produces a body a few hundred bytes larger
than that, so the shipped config now sets `26MiB` and the same measurement's boundary moves with
it.

If you reproduce this yourself, **aim it at a real upload endpoint**. Pointing it at an
arbitrary path measures nothing: the API answers `404` as soon as it has the headers, without
ever reading the body, so the request finishes before the proxy's limit is reached and you get a
`404` that looks like the limit is missing.

The two API rules differ on purpose. Better Auth derives its mount path from the URL it is
configured with and matches incoming requests against it, so `/auth` has to be the same string
on the server, in the browser and in the verification links it emails; the rest of the API is
mounted at its own root and gets the prefix removed on the way in. In nginx:

```nginx
location /auth/ {
  proxy_pass http://api:4000;                      # no trailing slash → path preserved
  client_max_body_size 64k;                        # EQUAL to AUTH_BODY_MAX_BYTES (64 KiB): an
                                                   # auth body has no multipart envelope, so the
                                                   # two layers count the same bytes.
}
location /api/  {
  proxy_pass http://api:4000/;                     # trailing slash    → /api stripped
  client_max_body_size 26m;                        # ABOVE ATTACHMENT_MAX_BYTES (25 MiB), not
                                                   # equal to it — the multipart envelope rides
                                                   # on top of the file. See the section above.
}
location /      { proxy_pass http://web:3000;  }
```

If your proxy sits in front of Kurul's own `proxy` rather than replacing it, set `TRUST_PROXY`
in `.env` to the number of hops (a CDN in front of Caddy makes it `2`). `docker-compose.yml`
forwards that variable to the `api` service with a default of `1`, so a blank or absent line is
the single-hop case, and the value survives the re-fetch of the compose file that every
[upgrade](#upgrading) does. Left at `1` behind two hops, every rate-limit bucket and every
access-log IP collapses onto your outer proxy's address. Set to `false` (the value an older
`.env.example` shipped, from before compose forwarded the line) the same happens behind one hop,
so remove such a line rather than leave it.

## Why there is no rebuild

Next.js compiles `NEXT_PUBLIC_*` variables into the JavaScript it ships, at build time. An
absolute `NEXT_PUBLIC_API_URL` therefore makes a web image specific to one deployment, and
"pull the image, set the environment" cannot work — which is exactly what Kurul used to
require ([audit finding PM-02](https://github.com/dravcore/kurul/issues/119)).

One `NEXT_PUBLIC_*` value is still baked, because nothing that would be correct everywhere
exists to bake in its place: the browser Sentry DSN.
[Browser error tracking](#browser-error-tracking) below says what that means for a pull-based
install.

The fix is not to un-bake the value but to bake a value that is already correct everywhere. The
published image carries `NEXT_PUBLIC_API_URL=/api`, a path on whatever origin the page was
served from, so it is right on `kurul.example.com` and on `boards.acme.internal` alike. That
only holds because the reverse proxy puts both apps on one origin, which is why `proxy` is part
of the default stack rather than an optional extra.

Server-side rendering cannot use a path — there is no origin to resolve it against inside
Node — so it reads `INTERNAL_API_URL` instead, which is an ordinary runtime variable
docker-compose.yml points straight at `http://api:4000` over the container network.

A deployment that genuinely wants the API on its own hostname can still build the web image
with an absolute URL:

```bash
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .
```

That image is then specific to `api.example.com`, and you are back to rebuilding per
deployment — which is the trade-off, not an oversight.

### Browser error tracking

`NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` and `NEXT_PUBLIC_SENTRY_RELEASE` are
compiled into the web bundle when the image is built: `docker-compose.yml` passes them as
`build.args`, not as `environment:`, and unlike the API URL there is no deployment-independent
value to bake, because a DSN names one Sentry project. The release workflow builds
`ghcr.io/dravcore/kurul-web` with all three blank, and blank means the Sentry SDK is left out of
the bundle entirely. So the published image ships without browser error tracking, and a
`NEXT_PUBLIC_SENTRY_DSN` line in `.env` on the install this page describes changes nothing,
with no warning in any log. The API side is different: `SENTRY_DSN` is an ordinary runtime
variable, read at container start, and works from `.env` as
[Error tracking](development.md#error-tracking-sentry--off-by-default) describes.

Browser error tracking therefore means building the web image yourself, which needs a source
tree the `curl` install does not have. Put the `NEXT_PUBLIC_SENTRY_*` lines in your `.env`,
clone the tag you run, and build from a copy of that `.env` so the result carries the same
`TAG` your install resolves:

```bash
git clone --branch v0.4.0 https://github.com/dravcore/kurul.git /opt/kurul-src
cp /opt/kurul/.env /opt/kurul-src/.env
cd /opt/kurul-src && docker compose build web      # tags ghcr.io/dravcore/kurul-web:<TAG>
cd /opt/kurul && docker compose up -d web          # no pull: uses the image just built
```

Without a compose file, the same build is
`docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_SENTRY_DSN=https://... .` from the
clone. Either way the image is specific to one Sentry project, and the `docker compose pull` of
the next [upgrade](#upgrading) replaces it with the published one: rebuild after every upgrade,
or the tracking stops with it. The rest of the setup, the two projects and what is sent, is in
[Error tracking](development.md#error-tracking-sentry--off-by-default).

## Troubleshooting

**`docker compose pull` ends in `denied`.** The images are published by a workflow that runs
on a release tag, so each exists only from the release that first shipped it: `api` and `web`
from `v0.2.0`, `kurul-migrate` from `v0.3.0`. On `v0.2.0` the pull therefore fails for that one
image even though the other two resolve, and `docker compose pull` exits non-zero after
successfully pulling `postgres`, `redis` and `caddy`: read the tail of its output, not just the
exit code, because the ones that worked scroll the ones that did not off the screen. The same
symptom on a newer release usually means the files and the images disagree: a
`docker-compose.yml` fetched from `main`, or from a newer tag than `TAG`, can name an image or a
service the release you pinned never published, which is why step 2 fetches every file from the
tag in `TAG` and why an [upgrade](#upgrading) re-fetches them. Re-fetch at the right tag, or
build from source instead of pulling:

```bash
git clone https://github.com/dravcore/kurul.git && cd kurul
docker compose up -d --build
```

That is slower — the api image is a minute or so of build — and it is the only difference.
`docker-compose.yml` carries `image:` and `build:` for all three services on purpose, so the
same file installs from a published image when one is resolvable and from source when it is
not.

**Certificate never issues.** Ports 80 and 443 must both reach the server from the public
internet, and DNS must already resolve. `docker compose logs proxy` names the failure. Hitting
Let's Encrypt's rate limit (5 certificates per domain per week) means waiting it out — the
`caddy_data` volume exists to make sure a restart never re-requests one it already has.

**Boards load but never update by themselves.** The WebSocket is not getting through. With the
bundled `proxy` this should not happen; with your own, check that your `/api/*` rule forwards
`Upgrade`/`Connection` headers.

**Sign-in fails right after changing the domain.** `SITE_URL` is the origin the session cookie
is scoped to. Change it, run `docker compose up -d` (which recreates `api` with the new value),
and sign in again — the old cookie belongs to the old origin.

**Everything 502s.** `docker compose ps`. If `api` is unhealthy, `docker compose logs api`; the
usual cause is a `POSTGRES_PASSWORD` in `.env` that no longer matches the one baked into an
existing `postgres_data` volume — see
[Database and cache credentials](development.md#database-and-cache-credentials).
