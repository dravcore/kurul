# API Conventions

REST conventions for the Kurultay API: URLs, verbs, payloads, errors, pagination, and DTOs.

> 🌐 English (canonical) | [Türkçe](tr/api-conventions.md)

## Contents

- [Scope](#scope)
- [Resource naming](#resource-naming)
- [HTTP verbs and status codes](#http-verbs-and-status-codes)
- [Request and response bodies](#request-and-response-bodies)
- [Errors](#errors)
- [Cross-origin requests](#cross-origin-requests)
- [Rate limiting](#rate-limiting)
- [Pagination](#pagination)
- [Filtering, sorting, field selection](#filtering-sorting-field-selection)
- [DTO naming](#dto-naming)
- [Data types](#data-types)
- [Versioning](#versioning)

## Scope

These rules apply to every HTTP endpoint in `apps/api`. Socket.io events follow their own
contract, defined in `@kurultay/shared-types` and described in
[architecture.md](architecture.md).

Base URL in development: `http://localhost:4000`.

## Resource naming

| Rule                                               |                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nouns, not verbs                                   | `/tasks`, never `/getTasks`                                                                                                                                                                                                                                 |
| Plural collections                                 | `/boards`, `/tasks`, `/workspaces`                                                                                                                                                                                                                          |
| kebab-case in paths                                | `/workspace-members`, not `/workspaceMembers`                                                                                                                                                                                                               |
| camelCase path params                              | `:workspaceId`, `:boardId`, `:taskId`                                                                                                                                                                                                                       |
| Nesting expresses ownership                        | A collection is reached through its owner: a board's tasks, a task's comments                                                                                                                                                                               |
| Nesting stops at 2 levels below the workspace root | `:workspaceId` is mandatory on every route and does not count toward the limit — it is the tenant scope, not a hierarchy level. Deeper hierarchies use query filters instead                                                                                |
| Once a resource has an id, address it shallowly    | `/workspaces/:workspaceId/tasks/:taskId`, never `/workspaces/:workspaceId/boards/:boardId/tasks/:taskId`. The id already identifies the row; the workspace guard already scopes it. The parent segment adds a value the server must validate for no benefit |

### Workspace scoping

**Every resource-bearing route is nested under a workspace.** This is not decoration — it is
how multi-tenant isolation is enforced at the guard level, before any service code runs. A
route without `:workspaceId` cannot be scoped by a guard and is therefore not allowed,
except for the account-level routes listed below.

```
GET    /workspaces
POST   /workspaces
GET    /workspaces/:workspaceId
PATCH  /workspaces/:workspaceId
DELETE /workspaces/:workspaceId

GET    /workspaces/:workspaceId/members        # cursor page of the roster
GET    /workspaces/:workspaceId/members/me     # the caller's own membership
POST   /workspaces/:workspaceId/members/me/leave      # leave the workspace (any role)
DELETE /workspaces/:workspaceId/members/:userId       # remove a member (OWNER/ADMIN)
PATCH  /workspaces/:workspaceId/members/:userId/role  # change a member's role (OWNER/ADMIN)
GET    /workspaces/:workspaceId/invitations     # cursor page of pending invitations (OWNER/ADMIN)
POST   /workspaces/:workspaceId/invitations
DELETE /workspaces/:workspaceId/invitations/:invitationId

GET    /workspaces/:workspaceId/boards
POST   /workspaces/:workspaceId/boards
GET    /workspaces/:workspaceId/boards/:boardId
PATCH  /workspaces/:workspaceId/boards/:boardId
DELETE /workspaces/:workspaceId/boards/:boardId

GET    /workspaces/:workspaceId/boards/:boardId/columns
POST   /workspaces/:workspaceId/boards/:boardId/columns
POST   /workspaces/:workspaceId/boards/:boardId/columns/defaults  # seed an empty board
PATCH  /workspaces/:workspaceId/columns/:columnId
DELETE /workspaces/:workspaceId/columns/:columnId
PATCH  /workspaces/:workspaceId/columns/:columnId/position

GET    /workspaces/:workspaceId/boards/:boardId/tasks     # list, scoped to a board
POST   /workspaces/:workspaceId/boards/:boardId/tasks     # create in a board

GET    /workspaces/:workspaceId/tasks/:taskId
PATCH  /workspaces/:workspaceId/tasks/:taskId
DELETE /workspaces/:workspaceId/tasks/:taskId
PATCH  /workspaces/:workspaceId/tasks/:taskId/position

GET    /workspaces/:workspaceId/boards/:boardId/labels
POST   /workspaces/:workspaceId/boards/:boardId/labels
PATCH  /workspaces/:workspaceId/labels/:labelId
DELETE /workspaces/:workspaceId/labels/:labelId

POST   /workspaces/:workspaceId/tasks/:taskId/assignees
DELETE /workspaces/:workspaceId/tasks/:taskId/assignees/:userId
POST   /workspaces/:workspaceId/tasks/:taskId/labels
DELETE /workspaces/:workspaceId/tasks/:taskId/labels/:labelId

GET    /workspaces/:workspaceId/tasks/:taskId/comments
POST   /workspaces/:workspaceId/tasks/:taskId/comments
DELETE /workspaces/:workspaceId/comments/:commentId

POST   /workspaces/:workspaceId/tasks/:taskId/checklists
PATCH  /workspaces/:workspaceId/tasks/:taskId/checklists/:checklistId
PATCH  /workspaces/:workspaceId/tasks/:taskId/checklists/:checklistId/position
DELETE /workspaces/:workspaceId/tasks/:taskId/checklists/:checklistId
POST   /workspaces/:workspaceId/tasks/:taskId/checklists/:checklistId/items
PATCH  /workspaces/:workspaceId/tasks/:taskId/checklist-items/:itemId
PATCH  /workspaces/:workspaceId/tasks/:taskId/checklist-items/:itemId/position
DELETE /workspaces/:workspaceId/tasks/:taskId/checklist-items/:itemId  # no GET: checklists come back inside GET tasks/:taskId

GET    /workspaces/:workspaceId/activities                 # workspace activity feed
GET    /workspaces/:workspaceId/tasks/:taskId/activities    # task activity feed

GET    /workspaces/:workspaceId/dashboard/summary

GET    /workspaces/:workspaceId/notifications
GET    /workspaces/:workspaceId/notifications/unread-count
POST   /workspaces/:workspaceId/notifications/read-all
POST   /workspaces/:workspaceId/notifications/:notificationId/read
```

Board and column role gates:
[ADR 0009](decisions/0009-board-column-permissions.md). Task gates:
[ADR 0010](decisions/0010-task-permissions.md). Label and metadata gates:
[ADR 0011](decisions/0011-label-task-metadata-permissions.md). Comment delete authorship:
[ADR 0012](decisions/0012-comment-delete-authorship.md). Activity, dashboard, and notification
routes are read-only aggregations/feeds over the same data and inherit the workspace member
gate (`WorkspaceGuard`) — no separate role matrix.

Invitations are workspace-scoped in the public API. Persistence is the
`WorkspaceInvitation` table, mapped from Better Auth's organization plugin.
Product names map organization → Workspace — see
[ADR 0004](decisions/0004-auth-better-auth.md#domain-mapping-organization--workspace).

Note the shape: a **collection** is nested under the parent that owns it, because that is
what scopes the list. A **single resource** is addressed by its own id directly under the
workspace, because nothing further is needed to find it.

Non-workspace routes (the complete list):

```
GET   /health                # liveness, unauthenticated
GET   /health/ready          # readiness, unauthenticated
GET   /config                # instance capabilities; any signed-in caller
POST  /auth/*                # Better Auth handlers
GET   /me                    # current user profile
PATCH /me                    # own profile; interface language today
```

The two health routes answer different questions and are not interchangeable. `/health` is
liveness — the process is up — and touches nothing, so a dependency blip never gets an
instance restarted. `/health/ready` probes Postgres and Redis and answers `200` with
`{ status, checks }` when the instance can serve traffic, `503` with the same document when it
cannot; `checks` names the dependency that is down (`up` / `down` / `skipped`, the last one
meaning the deployment does not configure it). The failure body is intentionally the probe
document rather than the error envelope below — the caller is a healthcheck, not a client.

`PATCH /me` is not workspace-scoped and not role-gated: the subject is the caller, so the
session guard is the whole authorization story. It is also the only place `User.locale` is
written — see [decisions/0018-localization-strategy.md](decisions/0018-localization-strategy.md).

### Instance configuration

`GET /config` answers **"what is this deployment configured to do"** with an `InstanceConfigDto`:

```json
{ "mailEnabled": true }
```

| Field         | Meaning                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mailEnabled` | `false` when no SMTP host is configured, so every message is written to the API log and delivered nowhere — nobody can confirm an address or accept an invite |

Three rules hold this endpoint's shape, and each one is a decision that was available to make
differently:

- **It is not part of `/health`.** A healthcheck exists so an orchestrator can decide whether
  to restart the process, and "SMTP is unconfigured" is never a reason to restart anything —
  it is a permanent, intentional property of the deployment. `/health` is also `@Public()` and
  `@SkipRateLimit()`, an exemption that is only affordable because the document says nothing
  about the product; publishing configuration there would inherit both by accident.
- **It requires a session, and no role.** The leak is small, but nothing needs the endpoint to
  be public, and an unauthenticated one would hand a scanner a per-instance list of what a
  self-hosted install has left unconfigured. Nothing here varies by workspace or by role, so it
  carries no `:workspaceId` and no role gate. Rate limiting is the global default.
- **Every field is a capability, never tenant state.** A value that differs per workspace, per
  user, or per request belongs on the resource it describes. This document must stay cacheable
  as "what this server can do".

### Reporting what happened to an email

`InvitationDto.emailDelivery` is **optional**, carries `SENT` / `NOT_CONFIGURED` / `FAILED`
(`MailDeliveryStatus`), and appears on exactly one response: `POST /workspaces/:workspaceId/invitations`.

**An absent field is not `SENT`.** It means this API observed no send for the request, and a
client must not resolve that into a verdict. A listed invitation is a stored row while delivery
is an event that nothing records, so `GET .../invitations` never carries the field.

The reason it exists at all: the invitation email is sent inside Better Auth's
`sendInvitationEmail` hook, and a failed or log-only send is swallowed there by design (a
stored invitation must not be reported as failed because its notification bounced). That left
the admin with a `201` and no way to learn that nothing was delivered. The status is the
return channel — the request still succeeds, the invitation is still created, and the response
simply says what became of the email. Sending it is still not a precondition of anything: on a
deployment without SMTP the accept link in `acceptUrl` is the one path that works, which is
what the web client offers when the status is not `SENT`.

The same rule applies to any future endpoint that triggers mail: **report the delivery status,
never fail the request on it, and never infer one you did not observe.**

### Actions that are not CRUD

Some operations are not a resource update — moving a task recomputes ordering, an invitation
is accepted rather than edited. Model these as a **sub-resource with a verb-free name** where
possible, and as an explicit action segment where not:

```
PATCH /workspaces/:workspaceId/columns/:columnId/position
PATCH /workspaces/:workspaceId/tasks/:taskId/position
POST  /workspaces/:workspaceId/invitations/:invitationId/accept
POST  /workspaces/:workspaceId/tasks/:taskId/assignees
DELETE /workspaces/:workspaceId/tasks/:taskId/assignees/:userId
POST  /workspaces/:workspaceId/tasks/:taskId/labels
DELETE /workspaces/:workspaceId/tasks/:taskId/labels/:labelId
```

Action segments are the exception and each one needs a reason. Do not invent
`/tasks/:id/doUpdate`.

## HTTP verbs and status codes

| Verb     | Semantics                                    | Idempotent | Body | Success                        |
| -------- | -------------------------------------------- | ---------- | ---- | ------------------------------ |
| `GET`    | Read a resource or collection                | Yes        | No   | `200`                          |
| `POST`   | Create, or trigger a non-idempotent action   | No         | Yes  | `201` (create), `200` (action) |
| `PATCH`  | Partial update — only the sent fields change | No         | Yes  | `200`                          |
| `PUT`    | Full replacement                             | Yes        | Yes  | `200`                          |
| `DELETE` | Remove                                       | Yes        | No   | `204`                          |

**`PATCH` is the default for updates.** `PUT` is used only where a full replacement is
genuinely the operation (reordering an entire column, for example). A `PATCH` that omits a
field leaves it untouched; sending `null` explicitly clears a nullable field.

| Status                      | When                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `200 OK`                    | Successful read, update, or action                                                        |
| `201 Created`               | Resource created; body is the created resource                                            |
| `204 No Content`            | Successful delete; empty body                                                             |
| `400 Bad Request`           | Malformed request or validation failure                                                   |
| `401 Unauthorized`          | Missing or invalid session                                                                |
| `403 Forbidden`             | Authenticated, workspace member, but role is insufficient                                 |
| `404 Not Found`             | Resource does not exist **or** belongs to another workspace                               |
| `409 Conflict`              | Uniqueness violation (duplicate slug), or a conflicting concurrent change                 |
| `422 Unprocessable Entity`  | Semantically invalid though well-formed (e.g. moving a task to a column on another board) |
| `429 Too Many Requests`     | Rate limited                                                                              |
| `500 Internal Server Error` | Unhandled failure. Never leaks a stack trace.                                             |

**Cross-workspace access returns `404`, not `403`.** A `403` would confirm that the resource
exists, which leaks information across the tenant boundary. `403` is reserved for a
legitimate member whose role is too low.

## Request and response bodies

Resources are returned as **plain JSON objects**. There is no `data` wrapper, no `success`
flag, no envelope.

```jsonc
// GET /workspaces/w_1/tasks/t_1  → 200
{
  "id": "0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d",
  "boardId": "0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f",
  "columnId": "0198e2c0-c2d3-7a15-b6e7-8f90a1b2c3d4",
  "title": "Implement fractional indexing",
  "description": "Positions must survive concurrent moves.",
  "priority": "HIGH",
  "position": 1024.5,
  "dueDate": "2026-09-01T00:00:00.000Z",
  "estimatedMinutes": 240,
  "assignees": [{ "userId": "usr_1", "name": "Doğan", "avatarUrl": null }],
  "labels": [
    {
      "id": "lbl_1",
      "boardId": "0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f",
      "name": "backend",
      "color": "slot-1",
    },
  ],
  "createdById": "usr_1",
  "createdAt": "2026-08-08T09:12:31.114Z",
  "updatedAt": "2026-08-08T09:12:31.114Z",
}
```

Collections are the only exception: paginated lists carry their cursor metadata alongside
the items (see [Pagination](#pagination)).

Rules:

- JSON property names are `camelCase`.
- Omit nothing for the sake of size — a field that exists is always present, with `null` if
  empty. Clients should not have to distinguish "absent" from "null".
- Never return a Prisma entity directly. The response DTO decides what is public.
- `Content-Type: application/json; charset=utf-8` on every response with a body.

## Errors

Errors use a **problem-JSON-style object** (RFC 7807 in spirit, using NestJS's field names so
the framework's built-in exceptions and hand-written ones look identical):

```jsonc
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "details": [
    { "field": "title", "constraint": "isNotEmpty", "message": "title should not be empty" },
    {
      "field": "estimatedMinutes",
      "constraint": "min",
      "message": "estimatedMinutes must not be less than 0",
    },
  ],
  "path": "/workspaces/w_1/boards/b_1/tasks",
  "timestamp": "2026-08-08T09:12:31.114Z",
  "requestId": "0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d",
}
```

| Field        | Type   | Required | Meaning                                                             |
| ------------ | ------ | -------- | ------------------------------------------------------------------- |
| `statusCode` | number | yes      | Mirrors the HTTP status                                             |
| `error`      | string | yes      | Stable, machine-readable reason phrase (`Bad Request`, `Not Found`) |
| `message`    | string | yes      | Human-readable, single sentence, safe to log                        |
| `details`    | array  | no       | Per-field validation problems; present only for `400`/`422`         |
| `path`       | string | yes      | Request path                                                        |
| `timestamp`  | string | yes      | ISO 8601 UTC                                                        |
| `requestId`  | string | yes      | Correlation id; same value as the `X-Request-Id` response header    |

- One global exception filter produces this shape for **every** error, including unhandled
  ones. There is no second error format anywhere in the API.
- `message` is never a raw exception string in production, and stack traces are logged, not
  returned.
- Clients branch on `statusCode` and `error`, never on `message` text.

### Request correlation

Every request carries an id, and every response returns it in the `X-Request-Id` header. A
client may supply its own — an id minted by a reverse proxy or load balancer flows straight
through — as long as it is URL-safe and between 8 and 128 characters; anything else is
discarded and replaced with a generated [UUIDv7](#data-types), so a header value can never
reach a log line or a response body unsanitised.

The same id appears in three places, which is the point: the `X-Request-Id` header the client
received, the `requestId` field of the error envelope, and the server's log lines for that
request. A user reporting a failure quotes one id, and it selects exactly one request.

Each finished request also writes a single-line JSON access log to stdout:

```jsonc
{
  "ts": "2026-08-13T19:03:32.070Z",
  "level": "info", // info < 400, warn 4xx, error 5xx
  "requestId": "0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d",
  "method": "GET",
  "path": "/workspaces/w_1/tasks", // route only — the query string is stripped
  "status": 200,
  "durationMs": 15.444,
  "userId": "0198e2c1-9a11-7c40-8f2b-1d3e5a7c9b02", // omitted when unauthenticated
  "ip": "203.0.113.7", // Express's resolved client IP — see TRUST_PROXY below
}
```

That field list is closed. Request bodies, query strings, headers and cookies are never
logged: the query carries user-supplied filters and search terms, and the headers carry
session cookies and invitation tokens. `ip` is Express's own `req.ip`, not a raw header —
unconfigured, this is always the TCP peer, so behind an unconfigured reverse proxy it is the
proxy's address for every request. See `TRUST_PROXY` below.

## Cross-origin requests

Authentication is a **cookie**, so every request a browser makes to this API carries the
caller's session automatically — including one initiated by a page the caller did not intend
to act on. Three rules decide what the API does about that.

**Reads are governed by CORS.** `WEB_URL` is the single allowed origin, with
`credentials: true`. A `GET` from anywhere else still reaches a handler, but the browser
refuses to hand the response to the calling script.

**Writes must also announce an allowed origin.** `POST`, `PUT`, `PATCH` and `DELETE` are
checked server-side against an allowlist — the same one value, `WEB_URL`, so the browser-side
and server-side lists cannot drift. A request that announces a different origin, in `Origin`
or (when that is absent) in `Referer`, is refused with `403` and the standard error envelope
before it reaches a handler. `Origin: null` — what a sandboxed document or a laundering
redirect sends — is not on the list either. The check covers `/auth/*` as well as the Nest
routes, and Better Auth's own `originCheck` still runs underneath it.

**A request that announces no origin at all is allowed.** That is a deliberate boundary, not
an oversight: browsers are required to send `Origin` on every request whose method is not
`GET`/`HEAD`, `fetch`, XHR and form submissions alike, so there is no cross-site request
shape that carries a victim's cookie _and_ omits the header. Everything left in the
header-less case — `curl`, a CI script, a native client, the web app's own server-side
session lookup in `apps/web/middleware.ts` — cannot be induced by a hostile page to replay
someone else's ambient credentials, which is the entire mechanism the rule defends against.
Rejecting it would break every non-browser caller and close nothing.

The reason the second rule exists at all is that the first is not a fallback for it. A
cross-site `<form method="POST" enctype="application/x-www-form-urlencoded">` is a _simple
request_: the browser sends it with no preflight, so CORS never gets to decide anything, and
the body is parsed and acted on before the response the attacker never needed to read is
discarded. In a deployment where the session cookie is `SameSite=Lax` — which is what
[self-hosting](self-hosting.md)'s single-origin reverse proxy produces, and what Better Auth
emits by default — that request never carries the cookie and the point is moot. The origin
allowlist is what keeps the answer the same in a deployment that publishes the API on its own
domain, where the cookie has to be `SameSite=None` and `Lax` protects nothing.

Operator-facing consequence: **`WEB_URL` must be the exact origin the browser loads the app
from.** A wrong value now costs writes as well as reads. Any spelling of the right origin
works — trailing slash, a path, an explicit `:443` — because the value is reduced to the
origin serialisation a browser sends. A value that is not a URL fails the process at start
rather than producing an allowlist nothing matches.

## Rate limiting

Every endpoint has a request budget. Going over it returns `429` in the error envelope above,
with a `Retry-After` header giving the seconds to wait. Requests still under budget carry
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.

Budgets are counted **per client IP and per route** over a rolling minute — one endpoint
running hot never spends another endpoint's allowance.

| Endpoint                                    | Budget    | Why                                                                       |
| ------------------------------------------- | --------- | ------------------------------------------------------------------------- |
| Any endpoint, unless listed below           | 100 / min | Well clear of what a person generates; caps a script                      |
| `POST /workspaces/:workspaceId/invitations` | 10 / min  | Each call hands a message to the SMTP relay, addressed by the caller      |
| `GET .../boards/:boardId/tasks?q=`          | 30 / min  | `q=` is a trigram scan; the same route without `q=` keeps the default     |
| `/auth/sign-in*`, `/auth/sign-up*`          | 3 / 10s   | Better Auth's built-in rule for credential endpoints                      |
| `/auth/*` otherwise                         | 100 / min | Better Auth's own limiter — `/auth/*` bypasses the Nest router (ADR 0004) |
| `GET /health`, `GET /health/ready`          | exempt    | A throttled probe would report a healthy API as down                      |

Two limiters cover the surface because there are two routers. `/auth/*` is served by raw
Express below Nest, so `ThrottlerGuard` never sees it and Better Auth's own limiter handles
it. Better Auth's counters live in Redis when `REDIS_URL` is set — shared across instances,
surviving restarts — and in process memory otherwise, which is a supported single-instance
configuration. The Nest throttler's counters are always per-instance.

Both limiters key on the same resolved client IP, driven by one setting: `TRUST_PROXY`
(unset/`false` by default). Off, the app trusts nothing about a request beyond the raw TCP
connection — `req.ip` is always the socket peer, and any `X-Forwarded-For` a client sends is
ignored outright, which is what makes a directly-exposed instance safe from a client spoofing
its way into its own rate-limit bucket. Behind a reverse proxy (Caddy/Traefik terminating TLS
in front of the app), leaving it off means every request looks like it came from the proxy —
one shared budget for every real client, and the access log's `ip` field is equally useless.
Set `TRUST_PROXY` to the hop count (`1` for a single proxy) or the proxy's IP/CIDR, and Express
resolves the real client from `X-Forwarded-For` the same way for both routers. Better Auth
never consults this setting on its own — it re-parses `X-Forwarded-For` itself and would
otherwise accept a spoofed single-value header even with no proxy in front of the app at all —
so `auth/auth.ts` instead points Better Auth's `advanced.ipAddress.ipAddressHeaders` at a
private header the app stamps with the same Express-resolved address on every request,
overwriting anything a client sent. `TRUST_PROXY=true` trusts the entire forwarded chain with
no verification and must only be used when the API is unreachable except through the proxy —
on a directly-exposed instance it hands every attacker an unlimited budget.

`RATE_LIMIT_ENABLED=false` turns both limiters off. It exists for the integration suite,
which drives hundreds of requests per route from one address; a deployment that sets it has
no brute-force ceiling.

## Pagination

**Cursor pagination is the default.** Page-number pagination is acceptable only for
genuinely bounded collections (a board's columns) where the total count is small by
construction rather than by expectation.

"Members are always few" was that expectation, and it is how the roster spent a phase
returning a plain array behind `take: 1000` — a workspace past that simply lost its tail,
with nothing in the response saying so. A collection whose size is the user's decision gets
a cursor: an unpaginated list is a promise that the server can always return all of it.

Why cursor by default:

- `OFFSET` degrades linearly on large tables; keyset lookups stay flat.
- Rows are inserted underneath the client mid-session — by another user, and via the
  realtime layer, visibly. Offset pagination handles that worst: every insert before
  the client's window shifts the whole list and the next page repeats or skips rows.

### The cursor key is always `id`, never `position`

**This is a correctness rule, not a preference.** A keyset cursor only guarantees no dropped
rows if the field it is keyed on is _immutable_ for rows the client has not seen yet.
`Task.position` is the opposite of immutable: fractional indexing rewrites it on every
drag-and-drop ([`decisions/0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md)).
A task sitting past the client's cursor that someone drags to the top of the column now has
a `position` _below_ the cursor value — `WHERE position > :cursor` will never return it
again, and the row is silently dropped. Concurrent reordering is exactly why `position`
cannot be the cursor key.

`id` has the properties the cursor needs: it is a **UUIDv7**
([Data types](#data-types)), so it is immutable for the life of the row, monotonic with
insertion time, and index-local — a real keyset, not a random seek.

Board rendering still orders tasks by `position`; the two are separate concerns. `position`
decides where a card _appears_, `id` decides where the _page boundary_ falls. A client
paginating a large task list receives every row exactly once and sorts the accumulated set
by `position` for display.

### Cursor request and response

```
GET /workspaces/w_1/boards/b_1/tasks?limit=50&cursor=0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d
```

| Param    | Default | Max | Notes                                                                                |
| -------- | ------- | --- | ------------------------------------------------------------------------------------ |
| `limit`  | 50      | 100 | Values above the max are clamped, not rejected                                       |
| `cursor` | —       | —   | Opaque. The `id` of the last item from the previous page. Clients must not parse it. |

```jsonc
{
  "items": [/* … resources … */],
  "nextCursor": "0198e2c1-8b6d-7e93-a015-4c2f8d1e6b70", // null on the last page
  "hasMore": true,
}
```

### Page-based (small collections only)

```
GET /workspaces/w_1/some-bounded-collection?page=1&perPage=25
```

```jsonc
{
  "items": [/* … */],
  "page": 1,
  "perPage": 25,
  "total": 7,
  "totalPages": 1,
}
```

No endpoint uses this shape today — every paginated list is a `CursorPage<T>` from
`@kurultay/shared-types`. A collection that genuinely needs page numbers may return the
inline shape above until a dedicated type is worth it; do not invent a second shared
pagination default.

A list that fits in one page is still a page. `GET .../members` defaults `limit` to the
`100` ceiling, so an ordinary workspace is one request that answers `hasMore: false` — the
client walks the cursor only when there is something left to walk to.

## Filtering, sorting, field selection

| Concern              | Convention                                    | Example                                                                                                                |
| -------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Equality filter      | `?field=value`                                | `?priority=HIGH`                                                                                                       |
| Multiple values (OR) | Repeated or comma-separated                   | `?priority=HIGH,URGENT`                                                                                                |
| Relation filter      | `?relationId=value`                           | `?assigneeId=usr_1&labelId=lbl_2`                                                                                      |
| Range                | `?field[gte]=`, `?field[lte]=`                | `?dueDate[lte]=2026-09-01T00:00:00Z`                                                                                   |
| Null check           | `?field=null`                                 | `?dueDate=null`                                                                                                        |
| Free-text search     | `?q=`                                         | `?q=indexing`                                                                                                          |
| Sorting              | `?sort=field` / `?sort=-field` for descending | Reserved convention — **no list endpoint accepts `sort` yet**; unknown query keys are `400` via `forbidNonWhitelisted` |
| Multi-sort           | Comma-separated, priority left to right       | Same — not wired on any DTO today                                                                                      |

- Combined filters are **AND**; repeated values within one filter are **OR**.
- Only whitelisted fields are filterable and sortable, declared in the query DTO. An unknown
  filter is a `400`, never silently ignored — a silently dropped filter shows the user data
  they asked not to see.
- Default **display** sort for tasks is `position` ascending; for everything else,
  `-createdAt`. Note that a paginated task list is _walked_ by `id` regardless of the
  requested sort — see [Pagination](#the-cursor-key-is-always-id-never-position).
- No `?fields=` sparse-fieldset support. Response shapes are fixed by their DTO; if a client
  needs less, that is not worth the caching and typing complexity.

## DTO naming

| Purpose                  | Pattern                   | Example                          |
| ------------------------ | ------------------------- | -------------------------------- |
| Create request           | `Create<Entity>Dto`       | `CreateTaskDto`                  |
| Full/partial update      | `Update<Entity>Dto`       | `UpdateTaskDto`                  |
| Action request           | `<Verb><Entity>Dto`       | `MoveTaskDto`, `InviteMemberDto` |
| List query params        | `<Entity>QueryDto`        | `TaskQueryDto`                   |
| Single resource response | `<Entity>ResponseDto`     | `TaskResponseDto`                |
| List response            | `<Entity>ListResponseDto` | `TaskListResponseDto`            |

- One DTO per file, in the module's `dto/` folder, named in kebab-case:
  `create-task.dto.ts`.
- `UpdateXDto` derives from `CreateXDto` via `PartialType` rather than restating fields.
- Request DTOs carry `class-validator` decorators; response DTOs are plain shapes mirrored in
  `@kurultay/shared-types`.

Full DTO/validation rules: [coding-standards.md](coding-standards.md#dtos-and-validation).

## Data types

| Type            | Representation                                                                                                                                                   | Example                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Identifier      | **UUIDv7**, generated by Prisma's `@default(uuid(7))` (available since Prisma 5.18). Opaque to clients: never parsed, never sorted, never generated client-side. | `"0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d"` |
| Date/time       | **ISO 8601, always UTC, always with `Z`**                                                                                                                        | `"2026-08-08T09:12:31.114Z"`             |
| Date-only value | Still a full ISO 8601 timestamp at `T00:00:00.000Z`                                                                                                              | `"2026-09-01T00:00:00.000Z"`             |
| Duration        | Integer minutes (`estimatedMinutes`) — never a formatted string                                                                                                  | `240`                                    |
| Position        | `Float` (fractional indexing) — never assume integers or contiguity                                                                                              | `1024.5`                                 |
| Enum            | UPPER_SNAKE string, defined in shared types                                                                                                                      | `"HIGH"`, `"OWNER"`                      |
| Money           | Not used yet. When it is: integer minor units + currency code.                                                                                                   | —                                        |

The API never returns local time or a timezone offset. Formatting for the user's locale is
the frontend's job.

"Opaque" cuts both ways. UUIDv7 embeds a timestamp, and the server relies on that ordering
for cursor pagination — but clients must not. A client that sorts by `id` or reads a
creation time out of it is depending on an implementation detail that a future id strategy
would break. URL examples in this document abbreviate ids (`w_1`, `b_1`, `t_1`) for
readability; real ones are 36-character UUIDv7 strings.

## Versioning

**No `/v1` prefix before 1.0.** Adding a version segment now would imply a compatibility
promise the project is not making — and would have to be bumped repeatedly during the very
period the API is expected to churn. See
[git-strategy.md](git-strategy.md#versioning-policy-semver).

Until 1.0:

- Breaking API changes may ship in any `0.y.0` release.
- Every one is documented in `CHANGELOG.md` under `### Changed` / `### Removed`, with the
  old and new shape and a migration note.
- `@kurultay/shared-types` is versioned with the monorepo, so a client that pins the package
  version pins the contract.

At 1.0, the API is frozen behind SemVer. If a versioning scheme is needed after that, it will
be introduced by ADR — URI prefix (`/v1`) is the likely choice, decided when it is actually
needed rather than pre-emptively.

## See also

- [architecture.md](architecture.md) — module map, socket contract
- [coding-standards.md](coding-standards.md) — DTOs, validation, module boundaries
- [testing.md](testing.md) — what endpoint tests assert
- [git-strategy.md](git-strategy.md) — SemVer and changelog policy
- [project-skeleton.md](project-skeleton.md) — data model these resources map to
