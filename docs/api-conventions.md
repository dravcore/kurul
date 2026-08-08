# API Conventions

REST conventions for the Kurultay API: URLs, verbs, payloads, errors, pagination, and DTOs.

> 🌐 English (canonical) | [Türkçe](tr/api-conventions.md)

## Contents

- [Scope](#scope)
- [Resource naming](#resource-naming)
- [HTTP verbs and status codes](#http-verbs-and-status-codes)
- [Request and response bodies](#request-and-response-bodies)
- [Errors](#errors)
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

| Rule | |
|---|---|
| Nouns, not verbs | `/tasks`, never `/getTasks` |
| Plural collections | `/boards`, `/tasks`, `/workspaces` |
| kebab-case in paths | `/workspace-members`, not `/workspaceMembers` |
| camelCase path params | `:workspaceId`, `:boardId`, `:taskId` |
| Nesting expresses ownership | A collection is reached through its owner: a board's tasks, a task's comments |
| Nesting stops at 2 levels below the workspace root | `:workspaceId` is mandatory on every route and does not count toward the limit — it is the tenant scope, not a hierarchy level. Deeper hierarchies use query filters instead |
| Once a resource has an id, address it shallowly | `/workspaces/:workspaceId/tasks/:taskId`, never `/workspaces/:workspaceId/boards/:boardId/tasks/:taskId`. The id already identifies the row; the workspace guard already scopes it. The parent segment adds a value the server must validate for no benefit |

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

GET    /workspaces/:workspaceId/members
POST   /workspaces/:workspaceId/invitations

GET    /workspaces/:workspaceId/boards
POST   /workspaces/:workspaceId/boards
GET    /workspaces/:workspaceId/boards/:boardId

GET    /workspaces/:workspaceId/boards/:boardId/columns
POST   /workspaces/:workspaceId/boards/:boardId/columns

GET    /workspaces/:workspaceId/boards/:boardId/tasks     # list, scoped to a board
POST   /workspaces/:workspaceId/boards/:boardId/tasks     # create in a board

GET    /workspaces/:workspaceId/tasks/:taskId
PATCH  /workspaces/:workspaceId/tasks/:taskId
DELETE /workspaces/:workspaceId/tasks/:taskId

GET    /workspaces/:workspaceId/tasks/:taskId/comments
POST   /workspaces/:workspaceId/tasks/:taskId/comments
```

Note the shape: a **collection** is nested under the parent that owns it, because that is
what scopes the list. A **single resource** is addressed by its own id directly under the
workspace, because nothing further is needed to find it.

Non-workspace routes (the complete list):

```
GET  /health                 # liveness, unauthenticated
POST /auth/*                 # Better Auth handlers
GET  /me                     # current user profile
```

### Actions that are not CRUD

Some operations are not a resource update — moving a task recomputes ordering, an invitation
is accepted rather than edited. Model these as a **sub-resource with a verb-free name** where
possible, and as an explicit action segment where not:

```
PATCH /workspaces/:workspaceId/tasks/:taskId/position
POST  /workspaces/:workspaceId/invitations/:invitationId/accept
POST  /workspaces/:workspaceId/tasks/:taskId/assignees
```

Action segments are the exception and each one needs a reason. Do not invent
`/tasks/:id/doUpdate`.

## HTTP verbs and status codes

| Verb | Semantics | Idempotent | Body | Success |
|---|---|---|---|---|
| `GET` | Read a resource or collection | Yes | No | `200` |
| `POST` | Create, or trigger a non-idempotent action | No | Yes | `201` (create), `200` (action) |
| `PATCH` | Partial update — only the sent fields change | No | Yes | `200` |
| `PUT` | Full replacement | Yes | Yes | `200` |
| `DELETE` | Remove | Yes | No | `204` |

**`PATCH` is the default for updates.** `PUT` is used only where a full replacement is
genuinely the operation (reordering an entire column, for example). A `PATCH` that omits a
field leaves it untouched; sending `null` explicitly clears a nullable field.

| Status | When |
|---|---|
| `200 OK` | Successful read, update, or action |
| `201 Created` | Resource created; body is the created resource |
| `204 No Content` | Successful delete; empty body |
| `400 Bad Request` | Malformed request or validation failure |
| `401 Unauthorized` | Missing or invalid session |
| `403 Forbidden` | Authenticated, workspace member, but role is insufficient |
| `404 Not Found` | Resource does not exist **or** belongs to another workspace |
| `409 Conflict` | Uniqueness violation (duplicate slug), or a conflicting concurrent change |
| `422 Unprocessable Entity` | Semantically invalid though well-formed (e.g. moving a task to a column on another board) |
| `429 Too Many Requests` | Rate limited |
| `500 Internal Server Error` | Unhandled failure. Never leaks a stack trace. |

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
  "assignees": [{ "id": "usr_1", "name": "Doğan", "avatarUrl": null }],
  "labels": [{ "id": "lbl_1", "name": "backend", "color": "#00C896" }],
  "createdById": "usr_1",
  "createdAt": "2026-08-08T09:12:31.114Z",
  "updatedAt": "2026-08-08T09:12:31.114Z"
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
    { "field": "estimatedMinutes", "constraint": "min", "message": "estimatedMinutes must not be less than 0" }
  ],
  "path": "/workspaces/w_1/boards/b_1/tasks",
  "timestamp": "2026-08-08T09:12:31.114Z"
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `statusCode` | number | yes | Mirrors the HTTP status |
| `error` | string | yes | Stable, machine-readable reason phrase (`Bad Request`, `Not Found`) |
| `message` | string | yes | Human-readable, single sentence, safe to log |
| `details` | array | no | Per-field validation problems; present only for `400`/`422` |
| `path` | string | yes | Request path |
| `timestamp` | string | yes | ISO 8601 UTC |

- One global exception filter produces this shape for **every** error, including unhandled
  ones. There is no second error format anywhere in the API.
- `message` is never a raw exception string in production, and stack traces are logged, not
  returned.
- Clients branch on `statusCode` and `error`, never on `message` text.

## Pagination

**Cursor pagination is the default.** Page-number pagination is acceptable only for small,
bounded collections (a workspace's members, a board's columns) where the total count is
naturally small and stable.

Why cursor by default:

- `OFFSET` degrades linearly on large tables; keyset lookups stay flat.
- Rows are inserted underneath the client mid-session — by another user, and once the
  realtime layer lands, visibly. Offset pagination handles that worst: every insert before
  the client's window shifts the whole list and the next page repeats or skips rows.

### The cursor key is always `id`, never `position`

**This is a correctness rule, not a preference.** A keyset cursor only guarantees no dropped
rows if the field it is keyed on is *immutable* for rows the client has not seen yet.
`Task.position` is the opposite of immutable: fractional indexing rewrites it on every
drag-and-drop ([`decisions/0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md)).
A task sitting past the client's cursor that someone drags to the top of the column now has
a `position` *below* the cursor value — `WHERE position > :cursor` will never return it
again, and the row is silently dropped. Concurrent reordering is exactly why `position`
cannot be the cursor key.

`id` has the properties the cursor needs: it is a **UUIDv7**
([Data types](#data-types)), so it is immutable for the life of the row, monotonic with
insertion time, and index-local — a real keyset, not a random seek.

Board rendering still orders tasks by `position`; the two are separate concerns. `position`
decides where a card *appears*, `id` decides where the *page boundary* falls. A client
paginating a large task list receives every row exactly once and sorts the accumulated set
by `position` for display.

### Cursor request and response

```
GET /workspaces/w_1/boards/b_1/tasks?limit=50&cursor=0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d
```

| Param | Default | Max | Notes |
|---|---|---|---|
| `limit` | 50 | 100 | Values above the max are clamped, not rejected |
| `cursor` | — | — | Opaque. The `id` of the last item from the previous page. Clients must not parse it. |

```jsonc
{
  "items": [ /* … resources … */ ],
  "nextCursor": "0198e2c1-8b6d-7e93-a015-4c2f8d1e6b70",  // null on the last page
  "hasMore": true
}
```

### Page-based (small collections only)

```
GET /workspaces/w_1/members?page=1&perPage=25
```

```jsonc
{
  "items": [ /* … */ ],
  "page": 1,
  "perPage": 25,
  "total": 7,
  "totalPages": 1
}
```

Both shapes are typed in `@kurultay/shared-types` (`CursorPage<T>`, `OffsetPage<T>`) so
clients handle them generically.

## Filtering, sorting, field selection

| Concern | Convention | Example |
|---|---|---|
| Equality filter | `?field=value` | `?priority=HIGH` |
| Multiple values (OR) | Repeated or comma-separated | `?priority=HIGH,URGENT` |
| Relation filter | `?relationId=value` | `?assigneeId=usr_1&labelId=lbl_2` |
| Range | `?field[gte]=`, `?field[lte]=` | `?dueDate[lte]=2026-09-01T00:00:00Z` |
| Null check | `?field=null` | `?dueDate=null` |
| Free-text search | `?q=` | `?q=indexing` |
| Sorting | `?sort=field` / `?sort=-field` for descending | `?sort=-createdAt` |
| Multi-sort | Comma-separated, priority left to right | `?sort=priority,-dueDate` |

- Combined filters are **AND**; repeated values within one filter are **OR**.
- Only whitelisted fields are filterable and sortable, declared in the query DTO. An unknown
  filter is a `400`, never silently ignored — a silently dropped filter shows the user data
  they asked not to see.
- Default **display** sort for tasks is `position` ascending; for everything else,
  `-createdAt`. Note that a paginated task list is *walked* by `id` regardless of the
  requested sort — see [Pagination](#the-cursor-key-is-always-id-never-position).
- No `?fields=` sparse-fieldset support. Response shapes are fixed by their DTO; if a client
  needs less, that is not worth the caching and typing complexity.

## DTO naming

| Purpose | Pattern | Example |
|---|---|---|
| Create request | `Create<Entity>Dto` | `CreateTaskDto` |
| Full/partial update | `Update<Entity>Dto` | `UpdateTaskDto` |
| Action request | `<Verb><Entity>Dto` | `MoveTaskDto`, `InviteMemberDto` |
| List query params | `<Entity>QueryDto` | `TaskQueryDto` |
| Single resource response | `<Entity>ResponseDto` | `TaskResponseDto` |
| List response | `<Entity>ListResponseDto` | `TaskListResponseDto` |

- One DTO per file, in the module's `dto/` folder, named in kebab-case:
  `create-task.dto.ts`.
- `UpdateXDto` derives from `CreateXDto` via `PartialType` rather than restating fields.
- Request DTOs carry `class-validator` decorators; response DTOs are plain shapes mirrored in
  `@kurultay/shared-types`.

Full DTO/validation rules: [coding-standards.md](coding-standards.md#dtos-and-validation).

## Data types

| Type | Representation | Example |
|---|---|---|
| Identifier | **UUIDv7**, generated by Prisma's `@default(uuid(7))` (available since Prisma 5.18). Opaque to clients: never parsed, never sorted, never generated client-side. | `"0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d"` |
| Date/time | **ISO 8601, always UTC, always with `Z`** | `"2026-08-08T09:12:31.114Z"` |
| Date-only value | Still a full ISO 8601 timestamp at `T00:00:00.000Z` | `"2026-09-01T00:00:00.000Z"` |
| Duration | Integer minutes (`estimatedMinutes`) — never a formatted string | `240` |
| Position | `Float` (fractional indexing) — never assume integers or contiguity | `1024.5` |
| Enum | UPPER_SNAKE string, defined in shared types | `"HIGH"`, `"OWNER"` |
| Money | Not used yet. When it is: integer minor units + currency code. | — |

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
