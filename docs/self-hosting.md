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
docker compose ps        # every service healthy? (migrate is expected to show "exited")
```

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

| Path       | Goes to  | Prefix              |
| ---------- | -------- | ------------------- |
| `/auth/*`  | api:4000 | kept as-is          |
| `/api/*`   | api:4000 | `/api` **stripped** |
| everything | web:3000 | kept as-is          |

`/api/*` must also pass WebSocket upgrades through — that is the realtime board feed.

The two API rules differ on purpose. Better Auth derives its mount path from the URL it is
configured with and matches incoming requests against it, so `/auth` has to be the same string
on the server, in the browser and in the verification links it emails; the rest of the API is
mounted at its own root and gets the prefix removed on the way in. In nginx:

```nginx
location /auth/ { proxy_pass http://api:4000;  }   # no trailing slash → path preserved
location /api/  { proxy_pass http://api:4000/; }   # trailing slash    → /api stripped
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
