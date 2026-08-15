# Self-hosting Kurultay on your own domain

Put Kurultay on a server, on your domain, with HTTPS and working email. Everything below is
one page on purpose; budget about an hour, most of it waiting for DNS.

There is no build step. `docker compose pull` fetches images published for every release, and
the same image works on every domain — the API URL is not compiled into it (see
[Why there is no rebuild](#why-there-is-no-rebuild) if you want the reasoning).

## What you need

- A server with a public IP, Docker Engine 24+ and the Compose plugin. Two CPUs and 2 GB of
  RAM is enough for a small team.
- A domain you control, with **ports 80 and 443 open** to that server. Both are required:
  Let's Encrypt validates over port 80, browsers use 443.
- An SMTP account. Kurultay needs outgoing mail before anyone can accept an invitation — see
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

## 1. DNS

Point the hostname at your server and let it propagate before you start the stack — Caddy asks
for a certificate on its first boot, and a request that fails because DNS is not live yet
counts against Let's Encrypt's rate limit.

```
kurultay.example.com.   A     203.0.113.10
kurultay.example.com.   AAAA  2001:db8::10      # only if the server has IPv6
```

Check it from somewhere that is not the server itself:

```bash
dig +short kurultay.example.com
```

## 2. Fetch the compose file and configure

```bash
mkdir -p /opt/kurultay && cd /opt/kurultay
curl -fsSLO https://raw.githubusercontent.com/dravcore/kurultay/main/docker-compose.yml
curl -fsSL --create-dirs -o docker/Caddyfile \
  https://raw.githubusercontent.com/dravcore/kurultay/main/docker/Caddyfile
curl -fsSL -o .env https://raw.githubusercontent.com/dravcore/kurultay/main/.env.example
```

Edit `.env`. For a Docker-only install these are the lines that matter — everything else in the
file is either for the development loop or has a working default:

```bash
SITE_URL=https://kurultay.example.com          # your domain, scheme included

POSTGRES_PASSWORD=<openssl rand -hex 32>       # hex, not base64 — it goes inside a URL
BETTER_AUTH_SECRET=<openssl rand -hex 32>      # session signing key

SMTP_HOST=smtp.example.com                     # see "Email" below
SMTP_PORT=587
SMTP_USER=kurultay@example.com
SMTP_PASSWORD=<your smtp password>
SMTP_SECURE=false                              # true only for port 465
MAIL_FROM=Kurultay <kurultay@example.com>
```

Generate the two secrets with `openssl rand -hex 32`. Use `-hex`, not `-base64`: a base64
string can contain `/`, and both values end up inside a URL where a slash truncates it.

`SITE_URL` carries the scheme because that is what decides whether Caddy serves plain HTTP or
obtains a certificate. `https://…` switches automatic HTTPS on. `http://localhost` (the
default) is the local, no-domain install.

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
backup     Up 28 seconds
migrate    Exited (0) 27 seconds ago
postgres   Up 34 seconds (healthy)
proxy      Up 16 seconds
redis      Up 34 seconds (healthy)
web        Up 22 seconds (healthy)
```

`Exited (0)` on `migrate` is success — migrations applied, job done. A non-zero exit there is
the one to chase (`docker compose logs migrate`), and `api` will not have started at all.
`backup` and `proxy` show no `(healthy)` because neither declares a healthcheck, not because
anything is wrong with them.

The first request to `https://kurultay.example.com` may take a few seconds while Caddy
completes the ACME challenge. Watch it happen if it does not:

```bash
docker compose logs -f proxy
```

Open the site, create the first account, and create a workspace. The first account is a normal
account — Kurultay has no separate installer or admin bootstrap step.

## 4. Check it actually works

```bash
curl -sI https://kurultay.example.com | head -1          # 307 → /login
curl -s  https://kurultay.example.com/api/health/ready   # {"status":"ok", …}
```

Then, in the browser, open a board and drag a card. If the card moves for a second browser
window without a refresh, the realtime WebSocket is connected through the proxy — which is the
one part of the stack a naive reverse-proxy configuration tends to break silently.

Last, check the thing HTTPS was actually for. Sign in and look at the cookie you get back:

```bash
curl -si https://kurultay.example.com/auth/sign-in/email \
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

## 5. Point a monitor at it

This is a step of the deployment, not an optional extra, and it is the last one because it is
the first one that needs a running instance to watch. `restart: unless-stopped` brings a crashed
container back; nothing in this stack tells you when the host is down, the disk filled, or
Postgres stopped accepting connections. An external monitor is the only signal that survives the
machine it is watching.

Monitor this URL:

```
https://kurultay.example.com/api/health/ready
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

Then fire it once on purpose, because an alerting setup that has never fired is a hypothesis:

```bash
docker compose stop postgres
curl -s https://kurultay.example.com/api/health/ready   # 503, "database":"down"
# wait two intervals, expect the red alert
docker compose start postgres
curl -s https://kurultay.example.com/api/health/ready   # 200, "database":"up"
# expect the recovery mail
```

`/health/ready` returning `503` while `/health` stays `200` during that window is the correct
behaviour, not a bug — it is the difference the two endpoints exist to express.

## Email (SMTP)

Invitations are the one feature that hard-fails without SMTP: accepting an invitation requires
a verified email address, and verification needs a delivered message
([ADR 0013](decisions/0013-invitation-email-verification.md)). With `SMTP_HOST` unset the API
still boots and logs the message instead of sending it, so a solo install works fine — but
nobody can join your workspace. The Members screen says so in the product, too.

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

The `backup` service is already running: it writes a `pg_dump` archive into the `backup_data`
volume every `BACKUP_INTERVAL` seconds (24h by default) and keeps `BACKUP_KEEP` of them.

That covers "I deleted the wrong workspace". It does not cover a dead disk — the archives sit
on the same host as the database. Copy them off the machine:

```bash
docker run --rm -v kurultay_backup_data:/backups -v "$PWD:/out" alpine \
  sh -c 'cp /backups/$(ls -t /backups | head -1) /out/'
```

Restore steps are in [Upgrading and backups](development.md#upgrading-and-backups).

## Upgrading

```bash
docker compose pull && docker compose up -d
```

Migrations run automatically: the one-shot `migrate` service applies them before `api` starts.
Pin a release with `TAG=v0.2.0` in `.env` if you would rather upgrade deliberately than track
`latest`.

## Bringing your own reverse proxy

If you already run nginx, Traefik or another proxy and would rather not stack a second one,
you can replace the `proxy` service — but the routing contract is not negotiable, because the
web app is built against it. Three rules, in this order, all on one hostname:

| Path       | Goes to  | Prefix              | Max request body              |
| ---------- | -------- | ------------------- | ----------------------------- |
| `/auth/*`  | api:4000 | kept as-is          | proxy default is fine         |
| `/api/*`   | api:4000 | `/api` **stripped** | **25 MiB** (`26214400` bytes) |
| everything | web:3000 | kept as-is          | proxy default is fine         |

`/api/*` must also pass WebSocket upgrades through — that is the realtime board feed.

The body size on `/api/*` is part of the contract, not a tuning knob. It is the same number as
the API's `ATTACHMENT_MAX_BYTES` (`.env.example`), and the two are **not independently
tunable**: raise the API's without raising the proxy's and every upload over the proxy's limit
fails with a `413` the API never sees and never logs; raise the proxy's without raising the
API's and the proxy logs a successful request the API then rejects. Caddy imposes no body limit
of its own, which is why the bundled `docker/Caddyfile` has to set one explicitly — and nginx
defaults `client_max_body_size` to **1 MB**, so a replacement proxy that omits the row rejects
every attachment larger than a megabyte.

### Telling the two 413s apart

Both layers answer an oversized upload with `413`, and **the response body is what says which
one did it**:

| What you get back                                  | Who rejected it | What it means                                                            |
| -------------------------------------------------- | --------------- | ------------------------------------------------------------------------ |
| `413` with an **empty** body (`Content-Length: 0`) | the proxy       | working as designed — the request never reached the API                  |
| `413` with a **JSON** body carrying `statusCode`   | the API         | your proxy's limit is higher than `ATTACHMENT_MAX_BYTES`, or it has none |

The second row is the misconfiguration: the proxy carried a body the API then refused, which is
the wasted-upload half of the two-layer rule. The first row is the correct behaviour.

The headers do not help — Caddy's `413` carries no `Server` header, so only the body
distinguishes them. Everything the API itself rejects comes back as
`Content-Type: application/json; charset=utf-8` with a `{"statusCode":…,"error":…,"path":…,
"requestId":…}` envelope; the proxy's rejection carries no body at all.

**The proxy does not log this rejection.** `docker/Caddyfile` has no `log` directive — the API
already logs every request that reaches it, and access logs on both layers would double every
deployment's log volume for one size check — so a body rejected by the proxy appears in
`docker compose logs proxy` **not at all**. An empty `413` with nothing in the proxy log is the
expected result, not evidence that the limit is broken.

Measured on the shipped `docker/Caddyfile` against `caddy:2-alpine`: exactly `26214400` bytes →
`200`, one byte more → `413`, with `curl` exiting `0` on a well-formed status line — the
connection is closed properly rather than cut mid-upload.

If you reproduce this yourself, **aim it at a real upload endpoint**. Pointing it at an
arbitrary path measures nothing: the API answers `404` as soon as it has the headers, without
ever reading the body, so the request finishes before the proxy's limit is reached and you get a
`404` that looks like the limit is missing.

The two API rules differ on purpose. Better Auth derives its mount path from the URL it is
configured with and matches incoming requests against it, so `/auth` has to be the same string
on the server, in the browser and in the verification links it emails; the rest of the API is
mounted at its own root and gets the prefix removed on the way in. In nginx:

```nginx
location /auth/ { proxy_pass http://api:4000;  }   # no trailing slash → path preserved
location /api/  {
  proxy_pass http://api:4000/;                     # trailing slash    → /api stripped
  client_max_body_size 25m;                        # = ATTACHMENT_MAX_BYTES (26214400)
}
location /      { proxy_pass http://web:3000;  }
```

If your proxy sits in front of Kurultay's own `proxy` rather than replacing it, raise
`TRUST_PROXY` in `docker-compose.yml`'s `api` service to the number of hops (a CDN in front of
Caddy makes it `2`). Left at `1`, every rate-limit bucket and every access-log IP collapses
onto your outer proxy's address.

## Why there is no rebuild

Next.js compiles `NEXT_PUBLIC_*` variables into the JavaScript it ships, at build time. An
absolute `NEXT_PUBLIC_API_URL` therefore makes a web image specific to one deployment, and
"pull the image, set the environment" cannot work — which is exactly what Kurultay used to
require ([audit finding PM-02](https://github.com/dravcore/kurultay/issues/119)).

The fix is not to un-bake the value but to bake a value that is already correct everywhere. The
published image carries `NEXT_PUBLIC_API_URL=/api`, a path on whatever origin the page was
served from, so it is right on `kurultay.example.com` and on `boards.acme.internal` alike. That
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

## Troubleshooting

**`docker compose pull` ends in `denied`.** The `api` and `web` images are published by a
workflow that runs on a release tag, so they exist for `v0.2.0` and later and not for anything
older. Two things follow while you are on a release that predates them. `docker compose pull`
exits non-zero after successfully pulling `postgres`, `redis` and `caddy` — read the tail of its
output, not just the exit code, because the three that worked scroll the two that did not off
the screen. And the files you fetch in step 2 come from the `main` branch, which only carries
what the newest release carried: if `docker-compose.yml` has no `proxy:` service and there is no
`docker/Caddyfile` to download, you are ahead of the release, and none of the HTTPS in this
guide applies to what you just downloaded. Either wait for the release, or build from source
instead of pulling:

```bash
git clone https://github.com/dravcore/kurultay.git && cd kurultay
docker compose up -d --build
```

That is slower — the api image is a minute or so of build — and it is the only difference.
`docker-compose.yml` carries `image:` and `build:` for both services on purpose, so the same
file installs from a published image when one is resolvable and from source when it is not.

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
