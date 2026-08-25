# 0033. Webhook Delivery and Failure Policy: Workspace-Owned Endpoints, an Outbox Row, and a Signed Envelope

**Status:** Proposed
**Date:** 2026-08-26

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0033-webhook-delivery-and-failure-policy.md)

## Context

[ADR 0031](0031-api-versioning.md) put webhooks last in the 1.0 sequence "because signed delivery
and a failure policy deserve their own ADR and a contract to point at". This is that ADR. It is
written before any schema, any route and any queue exist, so the questions below are settled once,
here, rather than relitigated in the pull request that implements them.

[ROADMAP.md](../../ROADMAP.md)'s "API 1.0" section is the entire specification today: exactly three
events (`task.created`, `task.moved`, `task.completed`), "delivered per workspace to an
operator-configured URL", at-least-once with a signature, and a failure policy that "needs an ADR
rather than an implementation". That sentence is the only statement of endpoint ownership anywhere
in the repository. It arrived as prose in a documentation pull request rather than as a decision,
and it is the first thing this record has to confirm or replace, because everything downstream
branches on it: where the signing secret lives, whether an outbound URL is attacker-controlled,
whether there are management routes at all, and whether the work is an M or an L.

Discussion [#254](https://github.com/dravcore/kurul/discussions/254) is where the public
conversation lives. It has one upvote and no comments. Nobody outside the project has described a
use case, so nothing below can cite demand as a reason. What it can do is avoid choosing the
variant that is structurally unable to serve the population that pays.

**What the tree already has, and what it does not.**

- Every task mutation writes its `Activity` row inside its own transaction: `ActivityService.record(tx, …)`
  takes the transaction client and `TaskService` calls it inside the `$transaction` that performs
  the write. An outbox row has a place to be written from day one.
- `task.moved` snapshots `toColumnCategory` in its payload and not `fromColumnCategory`, so a
  `COMPLETED` to `COMPLETED` move and a `STARTED` to `COMPLETED` move cannot be told apart from the
  row alone.
- There is no `task.completed` and no `task.reopened` in `ActivityType`. Completion is derived, and
  the only definition in the codebase is the dashboard's: a `task.moved` row whose target column is
  in the `COMPLETED` category ([ADR 0019](0019-column-category.md)).
- A column's category can be changed by `PATCH`, which flips the completion state of every task
  sitting in it while writing one `column.updated` row and no per-task event.
- `task.moved` is also written when a card is dragged **within** its column: a same-column reorder
  takes the same code path as a real move.
- Every post-commit side effect today is fire-and-forget inside the request process:
  `realtime.emitToBoard` runs after `$transaction` resolves, and `NotificationMailer` is documented
  as never rejecting. Both are at-most-once by design, and neither is a pattern that at-least-once
  delivery can be copied from.
- BullMQ is imported in exactly two files, `notification/due-soon.worker.ts` and
  `retention/cleanup.worker.ts`, and both use it as a repeating scheduler. Nothing enqueues a job
  from a request path, and no outbox table exists.
- Personal access tokens set the credential precedent: `sha256` at rest, plaintext shown once, and
  [api-conventions.md](../api-conventions.md#authentication) advertises "a database dump yields no
  usable credential" as a stated property.
- `TELEMETRY_ENDPOINT` is the only outbound HTTP call site in the API, and three places say so in
  prose: the class comment in `telemetry.service.ts`, the module comment in `telemetry.module.ts`,
  and [development.md](../development.md).
- Nothing in `apps/api/src/common` classifies an outbound URL, and the published Compose stack puts
  `postgres:5432`, `redis:6379` and `web:3000` on the same network as the API container.
- `Activity` rows are already imported in bulk without per-row events: a Trello import writes one
  `board.imported` row for an entire board rather than one `task.created` per card
  ([ADR 0025](0025-trello-import-mapping.md)).

## Decision

Eleven decisions, in the order they depend on each other. The first one decides the shape of the
other ten.

### 0. A workspace owns its endpoints, not the operator

Three models were on the table.

| Model                              | What it means                                                                                                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Operator, instance-wide        | `WEBHOOK_URL` and `WEBHOOK_SECRET` read from the environment like `TELEMETRY_ENDPOINT`, forwarded in `docker-compose.yml`, one destination for the whole deployment, `workspaceId` in every payload. No table, no management routes, no tenant-supplied URL |
| (b) Workspace                      | A `WebhookEndpoint` table, managed over workspace-administration routes, a tenant-supplied URL, a per-endpoint secret, tenant-visible failure state                                                                                                         |
| (c) Operator first, then workspace | (a) ships first, with the payload and signature designed so (b) can be added later without changing the delivery format                                                                                                                                     |

**The decision is (b): a workspace configures its own endpoints.**

The reason is a consequence of [ADR 0028](0028-open-contributions-hosted-service.md) that nothing
in the repository has written down until now. On a self-hosted instance running one team the
operator and the team are the same people, so (a) serves them perfectly. On the hosted instance the
operator is Dravcore, so under (a) every paying workspace shares one URL and one secret that belong
to us, and a customer gets no usable webhook at all. The obvious escape is closed in the same ADR:
paid differences are "operational quantities (seats, boards, storage, similar), not features", so
webhooks cannot be sold as a tier. Under (a), therefore, webhooks are a **self-host-only feature**,
and the hosted product is the one that has less. That inverts what the hosted service is for: the
customer's purchase is that they do not have to run a server, not that they get a smaller product
for doing so.

(c) is the tempting compromise and is rejected on cost rather than on principle. What it saves is
the envelope and the signature, which are the cheapest part of the work and are fixed by this
record anyway. What it does not save is any of the expensive part: the moment endpoints become
tenant data, the egress validator, the secret at rest, the management routes, the demo refusal and
the delivery log all have to be written from scratch. It also leaves two configuration paths alive
at once, an environment pair and a table, which either both have to keep working forever or one has
to be removed in a breaking change to a self-hoster's `.env`.

The honest cost of (b) is stated here rather than in a footnote: it is the larger build, it is
being chosen for a population that has not yet asked for it in #254, and it is the model that makes
the SSRF question real. The counterweight is sequencing. Webhooks land at 1.0, after
[ADR 0034](0034-hosted-billing-and-plan-assignment.md)'s billing slice, by which time the hosted
instance either exists or has been abandoned; building the instance-wide version first means
writing the dispatcher twice with the second version needing every decision the first one avoided.

### 1. What the three events mean

`task.created` is the `task.created` activity row. One delivery per created task.

`task.moved` is the `task.moved` activity row **whose `fromColumnId` differs from its
`toColumnId`**. A same-column reorder writes the same activity row and is **not** a delivery: an
integrator keying on "moved" to mirror a status would otherwise receive a delivery for every drag
inside a column, all of them no-ops with position noise. `position` still rides in the payload; it
is data, not a trigger. The stored row is untouched by this rule, because two readers already count
`task.moved` rows (`ActivationService` and `DashboardService.countCompletedMovesByDay`) and
changing what the row means would change their numbers. The filter lives in the event definition.

`task.completed` **has no activity row and is derived**, exactly once, from a `task.moved`
transition where `fromColumnCategory != COMPLETED` and `toColumnCategory == COMPLETED`. Four
corollaries, all deliberate:

- **`CANCELED` is not completed.** [ADR 0019](0019-column-category.md) keeps the two categories
  apart, and a card dropped in "Won't do" has not been finished.
- **Done to done does not fire.** A board with two `COMPLETED` columns ("Done" and "Released")
  emits `task.completed` on entry to the first, and `task.moved` and nothing else on the way to the
  second.
- **Re-categorising a column does not fan out.** `PATCH`ing a column from `STARTED` to `COMPLETED`
  changes what completion means for every card already in it, and emits nothing for any of them.
  The alternative is one write producing an unbounded burst of deliveries, and the dashboard already
  documents the same asymmetry as a deliberate choice.
- **There is no `task.reopened`.** Leaving a `COMPLETED` column emits `task.moved`, which carries
  both categories (see the precondition below), so a consumer that wants the un-complete edge can
  compute it from the payload it already receives.

**Imports and cascades emit nothing.** A Trello import writes cards with `createMany` and one
`board.imported` row, so a 500-card import is not 500 `task.created` deliveries; a later
`board.imported` webhook is a separate decision, not this one. Deleting a board or a workspace
cascades inside Postgres with no application code running, so no delivery is possible and
`task.deleted` is out of scope. Both are non-goals rather than omissions, and both are stated so
they are not filed as bugs.

**Precondition, additive and cheap.** `task.moved`'s activity payload gains `fromColumnCategory`
beside the `toColumnCategory` it already snapshots. The from-column is already loaded at move time,
the field makes the completion transition computable from the row alone, and the dashboard is
unaffected because it only reads the `toColumn*` fields. This is the one code change this record
asks for ahead of the implementation.

### 2. The envelope

```jsonc
{
  "id": "0192f4c1-…", // delivery id, UUIDv7, unique per endpoint per event
  "type": "task.completed",
  "occurredAt": "2026-08-26T09:12:44.301Z", // the commit, not the send
  "workspaceId": "0192e0aa-…",
  "actorId": "0192d113-…", // null for anything the product does without a user
  "data": {/* TaskDto, snapshotted at commit time */},
}
```

`data` is a `TaskDto` as `packages/shared-types` defines it, snapshotted inside the transaction, not
re-read at send time: a delivery that lands twenty minutes late must describe the task as it was
when the event happened, not as it is now. `workspaceId` is in every payload even though an
endpoint belongs to exactly one workspace, so a consumer that fans several Kurul workspaces into one
receiver never has to key on the URL it registered.

The shapes are the `/v1` shapes. ADR 0031 requires it: the delivery format is a contract of its own,
and writing it against pre-`/v1` DTOs would mean breaking it on the day the prefix lands. That is
also why this record can be accepted now and implemented only at 1.0.

### 3. The signature

HMAC-SHA256 over the exact bytes `${timestamp}.${rawBody}`, hex-encoded, in three headers:

| Header              | Value                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| `X-Kurul-Signature` | One or more `v1=<hex>` values, comma-separated; see the rotation note below |
| `X-Kurul-Timestamp` | Unix seconds, the same value that was signed                                |
| `X-Kurul-Delivery`  | The delivery id, also `id` in the body, for the receiver's own idempotency  |

Signing the timestamp together with the body, rather than the body alone, is what makes a captured
request unreplayable: the receiver recomputes the MAC, then refuses a timestamp more than **five
minutes** from its own clock. Signing the body alone would let anyone who once observed a valid
request repeat it forever. The comparison on the receiver's side is a constant-time one, which the
documentation says out loud because the most common way to implement this correctly and still be
vulnerable is `==` on two strings.

**The header is a list, because a sender-side rotation makes it one.** Outside a rotation it carries
exactly one value. During the overlap window of section 6 the sender signs the same bytes with both
the new secret and the previous one and sends `v1=<hex>,v1=<hex>`, and a receiver accepts the
delivery if **any** listed value matches the secret it holds. This is the shape receivers already
know from other providers, and it is the only way this rotation can be lossless: Kurul produces the
MAC rather than verifying one, so "the previous secret stays valid" can only mean "the previous
secret is still one of the ones we sign with". Sending a single signature during the overlap would
fail every receiver still holding the other secret, which is the missed delivery the overlap exists
to prevent. The `v1=` prefix carries the second extension as well, a change of algorithm, and both
kinds of entry fit in the same list.

### 4. Delivery is an outbox row, then a job

One `WebhookDelivery` row per endpoint per event, inserted **in the same transaction as the
`Activity` row**, through the transaction client `ActivityService.record` already accepts. After
the transaction commits, one BullMQ job per delivery is enqueued on a `webhooks` queue with
`jobId` set to the delivery id, which makes the enqueue idempotent.

The window between commit and enqueue is real: a process that dies in it has a committed row and no
job. A repeating sweep on the same queue re-enqueues `pending` deliveries older than the retry
horizon, which closes the window without a distributed transaction and reuses the exact pattern
`due-soon.worker.ts` and `cleanup.worker.ts` already run. This is the part the current codebase
cannot supply by copying: mail and realtime are both fire-and-forget after commit, and building
webhooks on that pattern would make the roadmap's own "at-least-once" claim false on the first pod
restart.

**Only `2xx` is success.** `3xx` is a failure and is **not** followed: a redirect is how a validated
public hostname becomes a request to `169.254.169.254`. `4xx` and `5xx` are both failures and are
both retried, because the distinction between "your payload is wrong" and "I am down" is one the
receiver is not reliably able to make during an outage.

**No Redis, no webhooks.** `REDIS_URL` is optional for the API process and the two existing workers
already decline to start without it. Endpoint creation is refused with a clear error when Redis is
absent, rather than accepting an endpoint that will silently never deliver.

### 5. Retries, and what happens to a dead endpoint

Six attempts with exponential backoff over roughly an hour, using BullMQ's own `attempts` and
`backoff` options and reading the configured count back off the job the way `due-soon.worker.ts`
does. Exhausting them marks the delivery `failed` and is not by itself an alarm: a receiver that is
down for an hour is normal.

**An endpoint that fails 20 consecutive deliveries, or that has not succeeded in 24 hours, is
disabled.** `disabledAt` and `lastError` are stored on the endpoint and are readable by workspace
admins, and re-enabling it is an explicit admin action that also sends a test delivery. Automatic
re-enabling is deliberately absent: an endpoint that turns itself back on and fails again is a
retry loop with extra steps, and the person who can fix the receiver is the person who registered
it.

This is the decision that only model (b) can make. Under an operator model there is nobody in the
application who could re-enable anything, so the policy would have to be "log and keep trying
forever", and the roadmap's phrase "disabling a dead endpoint" would have no referent.

### 6. The secret at rest

**Generated by the server, shown once on creation, stored encrypted with AES-256-GCM under a key
derived from `BETTER_AUTH_SECRET` with HKDF.** Rotation issues a new secret and keeps the previous
one valid for 24 hours, which on the sending side means every delivery in that window is signed with
both and carries both values in `X-Kurul-Signature` (section 3), so a receiver can be updated at any
point in the window without a missed delivery. There is no reveal:
a lost secret is rotated, exactly as a lost personal access token is re-minted.

The PAT precedent cannot be followed here and the divergence needs saying. A token is verified, so
`sha256` at rest is enough and the plaintext is genuinely unrecoverable. An HMAC is **produced**, so
the sender must hold the secret in usable form at send time. Storing it as a plaintext column would
quietly retire a property [api-conventions.md](../api-conventions.md#authentication) advertises in
so many words. Encryption under an instance-derived key restores most of it: a dump of the database
alone yields nothing, and an attacker needs the environment too.

The cost is stated where an operator will read it: changing `BETTER_AUTH_SECRET` invalidates every
webhook secret on the instance, and those endpoints must be rotated. That belongs in
`docs/self-hosting.md` beside the variable, not only here.

### 7. Egress policy

A tenant-supplied URL is an attacker-supplied URL, and the API container can reach `postgres`,
`redis` and `web` by name. A new `common/outbound-url.ts` classifies a destination and is applied
**twice**, at endpoint create/update and again immediately before each send:

- `https` is required. `http` is allowed only when `WEBHOOK_ALLOW_INSECURE_URLS=true`, which exists
  for a self-hosted LAN receiver and is off by default.
- Loopback, private, link-local, unique-local, multicast and unspecified addresses are refused, as
  are `.local` and `.internal` hostnames.
- DNS is resolved and the **resolved address** is re-checked before connecting, because a hostname
  that validated an hour ago can resolve to `127.0.0.1` now.
- Redirects are not followed (`redirect: 'manual'`), which is already implied by "only `2xx` is
  success".
- The response body is read to a few kilobytes and discarded; the connection carries a timeout from
  `WEBHOOK_TIMEOUT_MS`, mirroring `TELEMETRY_TIMEOUT_MS`.

Under model (a) none of this would have been needed, because `TELEMETRY_ENDPOINT` is trusted for
the sound reason that the operator wrote it. It is the price of the model that serves hosted
customers, and it is charged in full rather than deferred.

### 8. The delivery log, its window and its indexes

`WebhookDelivery` keeps the response status and at most 1 KB of the response body, truncated. It is
the highest-volume table webhooks add, one row per endpoint per event, so it gets a retention window
at creation rather than after the first complaint: **30 days**, `WEBHOOK_DELIVERY_RETENTION_DAYS`,
`0` meaning keep forever, added to [ADR 0020](0020-data-retention.md)'s table and to
`cleanup.worker.ts`'s `retentionSettings()`, which reads every window by name and sweeps nothing it
has not been told about.

Two indexes, decided now because adding them later means a migration against the largest table in
the schema: `(endpointId, id)` for the cursor-paged list ([api-conventions.md](../api-conventions.md#pagination)
keys cursors on `id`, never on a sort column), and a partial index on `(status, nextAttemptAt)` for
the pending sweep. This is a deliberate exception to [ADR 0020](0020-data-retention.md)'s
measure-first stance on retention indexes, and issue
[#187](https://github.com/dravcore/kurul/issues/187) is the measurement: the existing unindexed
sweeps are a known cost on much smaller tables.

### 9. A demo instance refuses endpoint creation

`DEMO_MODE=true` refuses `POST` on the endpoint routes. A public demo where any visitor can register
an outbound URL is an open HTTP relay with a signature attached, which is a different class of
problem from the two routes `DemoRestrictedGuard` guards today and admits a third entry under the
guard's own stated rule.

### 10. Management routes, and where the capability is published

```
GET    /workspaces/:workspaceId/webhooks                        # endpoints, admins only
POST   /workspaces/:workspaceId/webhooks                        # create; the only response carrying the secret
PATCH  /workspaces/:workspaceId/webhooks/:endpointId            # url, enabled, re-enable
DELETE /workspaces/:workspaceId/webhooks/:endpointId
POST   /workspaces/:workspaceId/webhooks/:endpointId/test       # one signed test delivery, named rate limit
GET    /workspaces/:workspaceId/webhooks/:endpointId/deliveries # cursor-paged on id
```

All of them are `ADMIN_ROLES` **and** `@SessionOnly`, for the same reason the token routes are: a
standing credential must not be able to configure a second channel out of the workspace. A personal
access token gets `403`, and the OpenAPI document says `security: [session]` on every one of these
operations. That extends the boundary [api-conventions.md](../api-conventions.md#authentication)
already names rather than inventing a new rule.

The capability is **not** published on `GET /config`. `InstanceConfigDto` is deployment capability
and its own comments say "never tenant state"; whether a workspace has an endpoint is tenant state,
and the endpoint list route above is the read surface. This is the mirror image of what model (a)
would have needed, which was a `webhooksEnabled` boolean beside `mailEnabled`.

### 11. Non-goals

No ordering guarantee between deliveries, no batching, no filtering beyond the three event types,
no general event stream (`Activity`'s vocabulary is much larger and publishing it would freeze an
internal log as a public contract), no `board.imported`, no `task.deleted`, no OAuth app model. A
consumer that needs to reconcile reads `GET /workspaces/{workspaceId}/tasks`.

## Rationale

**Why ownership had to be decision zero.** Six of the ten decisions above have a different answer
under model (a): there is no secret at rest, no egress validator, no management routes, no
session-only question, no delivery log and no auto-disable, because there is nobody to disable it
for. Writing the failure policy before the owner was chosen would have produced a document that
answers questions the chosen model does not ask, which is the failure mode ADR 0031 wrote itself to
prevent for versioning.

**Why an outbox and not a queue-only design.** Enqueueing a job without a durable row makes Redis
the system of record for "this must be delivered", and Redis in this stack is a cache with a
password, not a database with backups. A row written in the same transaction as the `Activity` row
is durable by the same commit that made the event true, and the sweep turns "we might have missed
the enqueue" into a bounded delay instead of a lost delivery. The cost is one extra write per
endpoint per event and a table that has to be swept, both of which are accounted for above.

**Why `task.completed` is derived and not stored.** The alternative is a new `ActivityType`, which
would be a permanent addition to a vocabulary whose names can never be renamed once a row carries
one, in service of an event that is a pure function of a move the log already records. It would
also force an answer to the re-categorisation question in storage rather than in the delivery
policy: either the `PATCH` writes a row per affected task, or the feed acquires a completion event
that is silently wrong for some tasks. Deriving it keeps the asymmetry in one place, this document,
where it can be documented instead of materialised.

**Why the reorder filter lives in the event definition.** `task.moved` is a storage format with two
existing readers. Narrowing it at the source would change the activation funnel's and the
dashboard's numbers to fix a webhook that does not exist yet. Filtering at the dispatcher costs one
predicate and leaves the log alone.

**Why encryption rather than an honest plaintext column.** A plaintext column is defensible in
isolation: the operator can already read `DATABASE_URL`, so the extra reach an attacker gains from
a dump-only compromise is narrow. It was rejected because the project makes a specific, published
claim about credentials at rest, and a per-tenant secret sitting in the clear beside hashed tokens
makes that claim require an asterisk in the very document that states it. The price is real and is
named above: rotating `BETTER_AUTH_SECRET` becomes an event that breaks webhooks, which nothing in
the product does today.

**Why 30 days and not 90.** The delivery log answers one question, "why did my receiver not get
it", and it is asked within hours. `Activity`'s 365 days exist because the feed is a user-facing
promise of history; nothing promises history about a delivery attempt. A shorter window on the
highest-volume table is also what keeps the nightly sweep's cost proportional.

## Consequences

- **Three prose claims stop being true and must be rewritten in the same pull request as the
  dispatcher.** `telemetry.service.ts`'s "the only code path in Kurul that sends anything to a third
  party", `telemetry.module.ts`'s "nothing else in the codebase opens an outbound connection to a
  third party", and [development.md](../development.md)'s "no outbound request is made at all" with
  its Turkish mirror. The replacement promise is narrower and still checkable: telemetry remains the
  only destination the **code** names, and every other outbound request goes to an address a
  workspace admin registered and can see. [ADR 0021](0021-activation-funnel-and-opt-in-telemetry.md)'s
  principle survives in that reduced form, and the honest part of the change is that an auditor can
  no longer answer "where can this instance send data" from the environment alone: they have to read
  a table.
- **On acceptance, the [ROADMAP.md](../../ROADMAP.md) rows are rewritten to match.** The "Minimal
  webhooks" row in the API 1.0 section loses "operator-configured URL" and gains "configured per
  workspace by an admin", the "API 1.0 remainder" row links this record, and the deferred `PM-09`
  row keeps launch feedback as the pacing trigger. This ADR does not make those edits; the roadmap
  is a status document and this is the reason.
- **The effort stays L, and now for stated reasons.** Under model (a) this would have been an M.
  The delta is the endpoint table and its migration, the egress validator, the secret at rest, six
  routes with their OpenAPI entries, the delivery log with its sweep and indexes, and a settings
  screen the web owns. The existing `L` on the "API 1.0 remainder" row was already sized for this
  model.
- **A webhooks section is added to [api-conventions.md](../api-conventions.md) and its Turkish
  mirror**, carrying the envelope, the headers, the verification recipe and the retry table.
  OpenAPI 3.0 has no top-level `webhooks` object (that is 3.1) and the committed document is 3.0.0,
  so the outbound contract is documented in prose with the payload declared as a component schema,
  not as a generated operation. The management routes are ordinary generated operations.
- **`.env.example`, `docs/self-hosting.md`, `docker-compose.yml` and the Turkish mirrors gain
  `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_ALLOW_INSECURE_URLS` and `WEBHOOK_DELIVERY_RETENTION_DAYS`.** A
  variable that is not forwarded in the Compose `api` environment block does not exist for anyone
  running the published stack.
- **`fromColumnCategory` in the `task.moved` payload is additive and can land before the rest.** It
  is the only part of this record that is worth shipping ahead of the feature, and it is safe:
  payload readers ignore keys they do not know.
- **`WebhookEndpoint.createdById` is nullable with `onDelete: SetNull`.** An endpoint belongs to the
  workspace, not to the person who added it, and account deletion anonymises the user row
  ([ADR 0026](0026-account-deletion-anonymisation.md)) rather than taking the workspace's
  integrations down with it.
- **Delivery is at-least-once and receivers must be idempotent.** `X-Kurul-Delivery` is the key to
  do it with, and the documentation says so rather than implying exactly-once by omission.

## Alternatives considered

| Alternative                                                              | Why not                                                                                                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (a) Operator-configured `WEBHOOK_URL` for the instance                   | Cheaper by an M against an L, but every hosted workspace would share Dravcore's URL, and ADR 0028 forbids selling the fix as a feature. It makes webhooks self-host-only |
| (c) Operator first, workspace endpoints later                            | Saves only the envelope and signature, which this record fixes anyway; leaves two configuration paths that must both live forever or break a self-hoster's `.env`        |
| Per-workspace destinations held in operator configuration                | Needs an `InstanceSetting` table plus instance-admin write routes, which is a larger new surface than the workspace-owned table it is trying to avoid                    |
| Fire-and-forget after commit, like the mailer                            | At-most-once by design; the roadmap's "at-least-once" claim would be false on the first restart, and a crash between commit and send loses the event with no record      |
| BullMQ job with no outbox row                                            | Makes Redis the system of record for an obligation created by a Postgres commit; nothing backs it up and a flush loses deliveries silently                               |
| A stored `task.completed` activity type                                  | A permanent, unrenameable addition to the vocabulary for a pure function of a move already logged; forces the column re-categorisation question into storage             |
| Emitting `task.completed` for every task when a column is re-categorised | One `PATCH` becomes an unbounded burst of deliveries, and the asymmetry the dashboard already documents becomes a delivery storm instead of a sentence                   |
| Delivering same-column reorders as `task.moved`                          | Every drag inside a column becomes a delivery, all of them no-ops for any consumer mirroring a status                                                                    |
| Narrowing the `task.moved` activity row instead                          | Two existing readers count those rows; changing the storage format to shape a webhook would move the activation funnel's and the dashboard's numbers                     |
| Plaintext secret column                                                  | Retires the "a database dump yields no usable credential" property the token documentation advertises, for the first per-tenant secret the database would hold           |
| Signing the raw body only, without a timestamp                           | A captured request stays replayable forever; the timestamp in the signed string plus a five-minute window is what bounds it                                              |
| Following redirects on delivery                                          | A validated public hostname can redirect into the Compose network or to a metadata address, which is precisely what the egress validator exists to prevent               |
| Retrying forever instead of disabling an endpoint                        | A permanently dead receiver becomes an unbounded queue and a standing outbound scan from the instance; the admin who registered it is the one who can fix it             |
| Auto-re-enabling a disabled endpoint after a cooling period              | A retry loop with extra steps; nothing about the endpoint has changed, and the failure is on the receiver's side by definition                                           |
| Publishing `webhooksEnabled` on `GET /config`                            | `InstanceConfigDto` is deployment capability and says so; whether a workspace has an endpoint is tenant state and belongs on the workspace read                          |
| Token-usable endpoint management                                         | A standing credential that can add an egress destination is a second exfiltration channel; the token routes are session-only for the same reason                         |
| No retention window on the delivery log                                  | The highest-volume table webhooks add would grow forever, and adding a window plus its indexes later is a migration against the largest table in the schema              |
