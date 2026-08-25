# 0034. Hosted Billing and Plan Assignment: a Merchant of Record, One Subscription Row, and Nothing at All When Unconfigured

**Status:** Proposed
**Date:** 2026-08-26

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0034-hosted-billing-and-plan-assignment.md)

## Context

[ADR 0028](0028-open-contributions-hosted-service.md) decided where money comes from: "a hosted
service run by Dravcore. An account on our servers, free within a published set of limits, paid
above them", where the limits are "operational quantities (seats, boards, storage, similar), not
features", and where "the hosted service runs the same AGPL code that is in this repository,
including the plan-limit and billing code it needs".

[ADR 0032](0032-plan-limits.md) built the first half of that. One resolver answers every ceiling
question, and `Workspace.planLimits`, a nullable JSON column, lets one workspace carry ceilings of
its own without a migration. That ADR named what it was leaving open in so many words: "What
billing needs beyond ceilings (plan name, provider ids, period end) is a table 0028 will add for
its own reasons."

The seam is finished and unused. `Workspace.planLimits` has readers in `PlanLimitsService`,
`BoardService`, `AttachmentService`, `InstanceConfigController` and the sign-up refusal in
`mount-better-auth.ts`, and **no writer anywhere in `apps/api/src`**;
[self-hosting.md](../self-hosting.md) says plainly that "the app never writes it itself". There is
no `Subscription` model, no provider integration (`stripe`, `paddle` and `billing` match nothing
outside the plan-limit files), no receiver route, and no plan catalogue. `ROADMAP.md`'s billing row
carries one acceptance criterion, that provider integration sits behind configuration and is off by
default, and Phase 3 makes it trigger-based with the owner free to pull it forward.

Two properties of the existing code shape what a writer is allowed to do.

- **A malformed write means "unlimited", not "refused".** `parseWorkspacePlanOverride` drops keys
  it does not understand and values that are not non-negative integers, deliberately, because the
  column is data and refusing to serve a tenant over one bad JSON value would turn a bad write into
  an outage. That is the right behaviour for a reader and a trap for a writer: a plan assignment
  that writes `{"seats": "10"}` silently grants unlimited seats instead of failing loudly.
- **A raw-body receiver has exactly one place to be mounted.** `configure-app.ts` registers the
  origin check, then `mountBetterAuth`, then the body parsers last. A provider webhook whose
  signature covers raw bytes has to be registered in that middle slot, before `useBodyParser`, for
  the same reason the Better Auth mount is: a parser ahead of it hands it an already-consumed
  stream. The origin check ahead of it is not a problem, because it rejects only requests that
  _announce_ an origin outside the allowlist and a provider's server sends neither `Origin` nor
  `Referer`.

Beyond that: `ThrottlerGuard` and `SessionAuthGuard` are global, so an in-Nest receiver would need
`@Public` and a throttle exemption; `organizationHooks` already exist in `organization-options.ts`
and can be extended; and `DEMO_MODE` is the established shape for a feature flag read at call time
and published on `GET /config`.

## Decision

### 1. A merchant of record, with Paddle as the first adapter

Three provider models were weighed.

| Model                                      | What Dravcore would be                                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merchant of record (Paddle, Lemon Squeezy) | Not the seller. The provider sells to the customer, issues the invoice, collects and remits VAT and sales tax everywhere, and pays out on a schedule  |
| Payment processor (Stripe direct)          | The seller. Dravcore issues invoices and is responsible for registering, collecting and remitting consumption tax in every jurisdiction it sells into |
| Better Auth's Stripe plugin                | The seller, as above, with subscription state held by the auth library and keyed on the organization `referenceId`                                    |

**The decision is a merchant of record, and the first adapter is Paddle.**

The argument is not technical. Kurul is maintained by one person, resident in Türkiye, selling a
subscription to customers who will mostly be somewhere else. Under Stripe direct, cross-border
digital-service VAT is the maintainer's problem in every jurisdiction that has a threshold: EU OSS
registration, UK VAT, and a growing list of others, each with its own filing calendar. That work
does not scale down to a solo project, it is not deferrable (it accrues from the first sale), and
getting it wrong is a liability rather than a bug. A merchant of record is the seller of record on
every transaction, which moves all of it to the provider in exchange for a higher percentage. Paying
a few points more for the transaction is the cheapest possible way to buy back the only cost here
that a maintainer cannot fix by writing code.

Lemon Squeezy is the same model in the same bracket and stays as the named alternative;
it has been part of Stripe since 2024, which makes its independent direction a question rather than
an answer, and current fee schedules and terms for both are re-checked when this record is
implemented rather than trusted from the date on it.

**Better Auth's Stripe plugin is rejected in writing**, even though it is superficially the best
fit: `Workspace` _is_ the Better Auth organization ([ADR 0004](0004-auth-better-auth.md)), and the
plugin keys subscriptions on an organization `referenceId`, so the mapping this ADR spends a table
on would come for free. It is rejected for four reasons. It is a Stripe plugin, so adopting it
decides the provider question by tooling instead of on the merits, and the merits point the other
way. Its state lives in the auth library's own tables, so the entitlement write could not share a
transaction with the `Workspace.planLimits` update that is the entire point of the exercise. It
mounts under `/auth/*`, which is raw Express below the Nest router with no exception filter
listening, which is why the organization firewall there already writes its own error envelope by
hand. And it would tie the billing surface to a Better Auth major version. If the provider model is
ever revisited and Stripe direct wins, this rejection is revisited with it.

The code shape is one `BillingProvider` port with one implementation, in the shape
[ADR 0022](0022-attachment-storage.md) used for `StorageBackend`: a second adapter is written when a
second provider is actually needed, and the port exists so that need is not a rewrite.

### 2. One `Subscription` row per workspace

```prisma
model Subscription {
  id               String    @id @default(uuid(7))
  workspaceId      String    @unique
  provider         String
  customerId       String
  subscriptionId   String
  planCode         String
  status           String
  currentPeriodEnd DateTime?
  graceUntil       DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([provider, subscriptionId])
}
```

`workspaceId` is unique: a workspace has one plan, and the row is the answer to "what is this
workspace paying for". `onDelete: Cascade` matches every other workspace-owned table; a deleted
workspace's billing history lives with the provider, which is the system of record for money, not
this database. `status` and `planCode` are strings rather than enums because their vocabularies
belong to the provider and the catalogue respectively, and a Prisma enum makes every new value a
migration.

A row exists only for a workspace that has been through checkout. No row means the free plan, which
is also what every self-hosted workspace looks like, so the two cases share one code path instead of
needing a synthetic free-plan row created by an `afterCreateOrganization` hook.

A second table, `BillingEvent (provider, eventId, receivedAt)` with a unique index on
`(provider, eventId)`, is the idempotency ledger for section 4.

### 3. The plan catalogue is code, not rows

```ts
const PLAN_CATALOG = {
  free: { name: 'Free', limits: { seats: 3, boards: 3, storageBytes: 1_073_741_824 } },
  // …
} as const satisfies Record<string, PlanDefinition>;
```

`planCode` resolves through this constant to the exact `Workspace.planLimits` keys
[ADR 0032](0032-plan-limits.md) already understands (`seats`, `boards`, `storageBytes`), and to a
display name. There is no `Plan` table, for the reason the board template catalogue is also code:
the rows would never be edited by anybody except a deploy, a table makes the catalogue a fixture
every test and every environment has to seed, and a typed constant is a compile error when a plan
gains a ceiling instead of a silent `undefined`. The numbers above are placeholders; the published
tiers are a pricing decision, not an architecture one, and they land with the implementation.

The catalogue is instance-wide, not hosted-only. A self-hoster who never sets `BILLING_PROVIDER`
never resolves a `planCode` at all, so the constant costs them nothing but the bytes.

### 4. The entitlement write is one transaction, validated before it happens

The only thing that assigns a plan is a provider webhook event: subscription created, updated,
canceled, and payment failed. Handling one is:

1. Verify the signature over the raw body. An unverified request is `401` and nothing else happens.
2. Resolve `planCode` through `PLAN_CATALOG` and **validate the resulting limit object before
   writing it**, with the same predicate `parseWorkspacePlanOverride` applies when reading. An
   unknown `planCode`, or a limit that is not a non-negative integer, is refused: log it, answer
   `5xx` so the provider retries, and write nothing, which at this point is still literally true
   because nothing has been written yet. This step exists because the reader drops what it cannot
   use, so an unvalidated write of a bad shape does not fail, it grants unlimited.
3. **In one `$transaction`:** insert into `BillingEvent`, upsert `Subscription`, and write
   `Workspace.planLimits`. A unique-constraint violation on `(provider, eventId)` aborts that whole
   transaction, which is exactly the right outcome: the event was already applied, nothing is
   written twice, and the handler answers `200` and stops. Providers retry, and retrying is how
   at-least-once delivery is supposed to look from the receiving end.

**The ledger row is inside the transaction, not in front of it, and that ordering is the decision.**
An idempotency ledger committed before the write it protects is a promise that the write happened,
made before it did. Written that way, a refusal in step 2 or a crash between the two commits leaves
an event marked applied and a workspace that never got its plan, and the retry the provider is being
asked for is then answered `200` by the ledger row and dropped. Nothing outside the transaction
records progress, so the only two outcomes are "event recorded and entitlement written" and
"neither". A workspace whose `Subscription` row says "team" while its ceilings say "free" is the
other failure mode the single transaction prevents, and it is the one that generates support mail.

**A daily reconcile job** re-reads every active subscription from the provider and re-applies the
same write, in the `cleanup.worker.ts` shape: BullMQ, one repeating job, no start at all when
`REDIS_URL` is unset. Webhooks are lossy in ways nobody controls (an outage during the retry window,
a mis-scoped endpoint, an event type added by the provider), and a daily convergence pass is the
difference between a customer who paid and is throttled for a day and one who is throttled until
they write in. It is also the only mechanism that notices a subscription that ended without an event
ever arriving.

### 5. The receiver is mounted below the Nest router

```
POST /billing/webhooks/:provider
```

Registered in `configure-app.ts` in the slot after `mountBetterAuth` and before the body parsers,
with `express.raw({ type: 'application/json', limit: '64kb' })` scoped to that path, and a
hand-written error envelope in the shape the organization firewall already uses there. Three things
follow from that placement and are chosen for them: the raw bytes reach the signature check
unparsed; the route sits outside a future `/v1` by construction, exactly as `/auth/*` does
([ADR 0031](0031-api-versioning.md)), which is correct because its contract belongs to the provider
and not to Kurul's API; and it never meets the global `SessionAuthGuard`, so there is no `@Public`
annotation to forget.

The cost of skipping the global guards is that the throttler is skipped too. The compensations are
in the handler: the 64 KB body cap, a signature check that runs before any database work, and a
constant-time comparison. An unsigned request is `401` and costs one HMAC.

**Checkout is started from a session, by an owner.** `POST /workspaces/:workspaceId/billing/checkout`
is `MemberRole.OWNER` and `@SessionOnly`, and returns a provider-hosted URL. Owner rather than
`ADMIN_ROLES` because this one creates a payment obligation in someone's name, which is a narrower
question than workspace administration; session-only for the reason the token routes are, that a
standing credential should not be able to start a purchase.

### 6. Failure is a grace period, and nothing is ever deleted

On a failed payment the workspace keeps its current ceilings until `graceUntil`, seven days by
default. When the grace period expires the reconcile job writes the free plan's limits, and that is
the whole downgrade: no board is deleted, no member is removed, no attachment is unlinked. ADR 0032's
ceilings are soft by design and refuse only **new** writes, so a workspace over its new ceiling
simply cannot add until it is back under, which is a state the plan-limit error envelope already
explains to the user with a code, a limit and a current count.

Deleting anything for non-payment would be the single most destructive thing this codebase could
learn to do, on the least reliable input it has (a third party's opinion about a card), and no part
of the product would be able to tell it apart from a bug.

### 7. Inert unless `BILLING_PROVIDER` is set

`BILLING_PROVIDER` unset is the self-hosted default and means:

- the billing module registers **no controller and no route**, so `POST /billing/webhooks/:provider`
  and the checkout route do not exist;
- no reconcile job is scheduled, and no queue is created;
- `GET /workspaces/{workspaceId}/plan` answers `plan: null`;
- `Workspace.planLimits` stays what [self-hosting.md](../self-hosting.md) says it is, a column an
  operator writes by hand.

This is a contract, not an intention, so it is proven the way contracts are: an e2e that boots the
API with `BILLING_PROVIDER` unset and asserts, document by document,

- that `GET /config` is **byte-identical** to the `InstanceConfigDto` the same build serves with a
  provider configured. Billing publishes no capability there at all, in either direction, so this
  one is an exact-equality assertion with nothing carved out of it;
- that `GET /workspaces/{workspaceId}/plan` differs from the document served before this record by
  **exactly one member and nothing else**: the `plan` key section 8 adds, whose value is `null`.
  `limits` and `usage` are byte-identical, and no other key appears anywhere in the response;
- that `POST /billing/webhooks/:provider` and the checkout route both answer `404`.

The second assertion is deliberately narrower than "byte-identical", and the difference is the point
rather than a concession. `plan` is a member of `WorkspacePlanDto` on **every** instance, not a
hosted-only key, because a client that has to branch on whether a field exists is a client that has
to know how the server was deployed. The property worth testing is therefore not that the document
never changed, it is that turning billing off adds nothing beyond the one `null` the published type
already promises. Asserting byte-equality on `/plan` would assert the opposite of what section 8
decides, and a test that cannot pass is worse than no test.

ADR 0028 promises self-hosters the same code with nothing held back; the reverse promise, that the
code they run holds nothing _extra_, needs a test rather than a paragraph.

### 8. `WorkspacePlanDto` gains a plan identity, additively

```ts
interface WorkspacePlanDto {
  limits: WorkspacePlanLimitsDto;
  usage: WorkspacePlanUsageDto;
  /** `null` on any instance with no billing provider configured. */
  plan: { code: string; name: string; manageUrl: string | null } | null;
}
```

The refusal envelope already names the ceiling that was hit and `plan-limit.exception.ts` already
anticipates "a hosted deployment mapping `planLimit.code` to an upgrade prompt", but nothing tells
a client which plan the workspace is on or where to change it. Adding it to the existing read keeps
ADR 0032's "two read surfaces" rule intact instead of introducing a third. `manageUrl` is the
provider's customer portal and is non-null only for an owner, because it is a link into a billing
account; every other member sees the code and the name.

### 9. Soft ceilings become billing boundaries, which fires ADR 0027's trigger

[ADR 0027](0027-attachment-quotas.md) considered a per-workspace `pg_advisory_xact_lock` and
rejected it in writing, and [ADR 0032](0032-plan-limits.md) restated the same trade for counts:
check-then-write, overshoot bounded by concurrency, "**Trigger:** a report of a ceiling being raced
deliberately". `BoardService` carries a comment pointing at that rejection.

Both rejections were correct for a ceiling that is an operator guard-rail. **Neither survives a
ceiling that is a revenue boundary**, and this record is the trigger firing rather than a
contradiction of either: a limit a customer can exceed by sending ten requests at once is not a
plan. So, **as part of the billing slice and not before it**, a per-workspace
`pg_advisory_xact_lock(hashtext(workspaceId))` is taken inside the transaction for board creation,
invitation creation and acceptance, and attachment creation, with a single fixed key around
sign-up for the instance-wide user ceiling. `GET .../plan` keeps its current unlocked reads, which
are a display and can be stale.

The order matters: the lock lands with billing, so an instance that never assigns a plan never pays
for the serialisation, and ADR 0027's argument that it "serializes every upload in a workspace"
stays true of exactly the deployments it was written about.

### 10. Token caps are plan quantities, deferred to the catalogue

A member can mint unlimited personal access tokens today, and a token's expiry is optional, so a
never-expiring credential is possible. For a self-hosted team that is not a defect. For a hosted
service, unbounded credentials per seat are a support and revocation problem. The answer is
**not** two new environment variables: ADR 0028 says paid differences are quantities, and
`PLAN_CATALOG` is now where a quantity lives. A `maxTokensPerMember` key enters the catalogue and
the plan-limit resolver when the hosted service has customers, refusing with the existing
`Plan Limit Exceeded` envelope. A maximum token **lifetime** is a different question, an API 1.0
hardening one rather than a plan one, and stays with the `/v1` remainder.

### 11. Hosted operational prerequisites, listed and not decided

Running the hosted service needs decisions this record deliberately does not make, because each is
its own ADR and none of them is on the critical path to charging a customer. They are listed so
that "what else does hosting need" has an answer that is not a memory:

| Prerequisite                                                                                                                                                                 | Trigger for deciding it                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Object storage behind the existing `StorageBackend` port (only `disk-storage-backend.ts` exists; ADR 0022 reserved the port)                                                 | The first hosted deployment that needs a second API instance                              |
| A metrics surface (`docs/development.md` states there is no Prometheus, no Grafana, no log shipper, by design)                                                               | The first availability commitment made to a customer                                      |
| Secrets from a manager rather than `.env`                                                                                                                                    | The first operator who is not the maintainer                                              |
| Multi-instance behaviour end to end (Socket.io already has the Redis adapter; the upload byte counters fall back to process memory when Redis errors, which is per-instance) | Same trigger as object storage; the Compose file already names the single-host constraint |
| Per-tenant backup and restore                                                                                                                                                | The first customer request to export or restore one workspace                             |

## Rationale

**Why the tax argument outranks the fee argument.** A merchant of record costs more per transaction
than a processor, and on a spreadsheet that is the whole comparison. It is the wrong spreadsheet.
The cost that actually threatens a solo project is not a percentage, it is a recurring compliance
obligation in jurisdictions the maintainer does not live in, with deadlines, filings and penalties,
which cannot be automated away by the person paying it and which arrives with the first sale rather
than at scale. Paying a provider to be the seller converts an open-ended legal exposure into a line
item. If Kurul ever reaches a volume where the percentage genuinely dominates, that is a good
problem, the port from section 1 is where a second adapter goes, and this record can be superseded
by one written from evidence instead of from prudence.

**Why the entitlement write validates before it writes.** This is the one place where
ADR 0032's deliberately forgiving reader becomes dangerous. Dropping an unusable key is right for a
column written by hand and read on every request; it means a bad write degrades to the instance
default rather than to an outage. But "degrades to the instance default" on a hosted instance with
no `PLAN_MAX_*` variables set means _unlimited_, so an unvalidated writer turns a typo into a free
enterprise plan and nothing anywhere reports it. The validation is four lines and it is the reason
the write is safe to automate at all.

**Why a daily reconcile in addition to webhooks.** Webhook delivery is at-least-once at best and
best-effort in practice; [ADR 0033](0033-webhook-delivery-and-failure-policy.md) says the same thing about Kurul's own outbound deliveries and
tells consumers to reconcile. It would be inconsistent to demand that of Kurul's consumers and then
trust a provider's events as the only source of truth here. The reconcile pass is also what makes
the grace expiry work without a timer: it is a daily job that already visits every subscription.

**Why the receiver is below Nest rather than a `@Public()` controller.** Both work. Below Nest, the
raw body is available without a Nest-specific opt-in, the route is outside `/v1` by construction so
it never becomes part of the versioned contract, and there is no chance of a future global guard
quietly applying to it. In Nest, the route would inherit the exception filter and the OpenAPI
document, which sounds like a gain until you notice that neither is wanted: the provider does not
read Kurul's error envelope, and publishing the receiver in the API documentation invites callers
it does not have.

**Why nothing is deleted on non-payment.** Because the product cannot distinguish "this customer
stopped paying" from "this provider had a bad day", and the two have the same webhook. Refusing new
writes is reversible by paying; deleting a board is not reversible by anything. The plan-limit layer
was built to refuse rather than to destroy, and billing should not be the first caller to ask it for
more than that.

## Consequences

- **The self-hosted product must be provably unchanged.** Section 7's e2e is the acceptance
  criterion for the whole slice, not a nice-to-have. Without it, "off by default" is a claim about
  code that the code does not check, and the first regression is discovered by a self-hoster.
- **New tables mean new retention rows.** `BillingEvent` is append-only and grows with every
  provider retry, so it enters [ADR 0020](0020-data-retention.md)'s table with a window (90 days is
  the proposal, long enough to answer "did we apply that event" and short enough that the ledger
  never needs an index for the sweep). `Subscription` has no window: it is one row per paying
  workspace and it cascades with its workspace.
- **The advisory lock changes measured behaviour on hosted instances.** Board creation, invitation
  creation and acceptance, and attachment creation serialise per workspace. That is a real latency
  cost under concurrency and it is accepted here for the deployments that need exact ceilings, on
  the trigger ADR 0027 itself specified.
- **On acceptance, [ROADMAP.md](../../ROADMAP.md) and [api-conventions.md](../api-conventions.md)
  change and this record does not change them.** The "Hosted service billing and plan assignment"
  row gains a link here and a first sub-item (the ADR itself), its acceptance criterion grows the
  inertness e2e, and the `Plan limits` section of api-conventions gains the `plan` member of
  `WorkspacePlanDto` with its Turkish mirror. `apps/api/openapi.json` is regenerated in the same
  pull request as the DTO change, because CI fails when the code and the document disagree.
- **`.env.example`, `docs/self-hosting.md`, `docker-compose.yml` and the Turkish mirrors gain
  `BILLING_PROVIDER` and the provider's key and signing-secret variables**, all unset, with the
  paragraph that says what unset means. A variable that is not forwarded in the Compose `api`
  environment block does not exist for anyone running the published stack.
- **A pricing decision is now blocking a code decision, and that is the right way round.**
  `PLAN_CATALOG`'s numbers cannot be written until the tiers are chosen. Everything else in this
  record can be built against placeholder tiers, which is why the catalogue is one constant and not
  a schema.
- **Money makes a new class of incident.** A signature check that regresses, a reconcile job that
  writes the free plan to a paying workspace, an event applied twice: each of these is now a
  customer-visible failure with a support cost, in a codebase whose worst current failure is a lost
  email. The idempotency ledger, the single transaction and the validation step are all here for
  that reason, and none of them is optional.

## Alternatives considered

| Alternative                                                                        | Why not                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe direct                                                                      | Makes a solo Türkiye-resident maintainer the seller of record and therefore responsible for cross-border VAT registration and filing everywhere they sell                                                                               |
| Better Auth's Stripe plugin, keyed on the organization `referenceId`               | Decides the provider by tooling; keeps subscription state in the auth library's tables, outside the transaction that writes `planLimits`; mounts under `/auth/*` where no exception filter runs; couples billing to a Better Auth major |
| A `Plan` table with rows per tier                                                  | A catalogue nothing but a deploy ever edits, made into a fixture every test and every environment must seed, losing compile-time errors when a tier gains a ceiling                                                                     |
| Ceilings stored on the `Subscription` row                                          | Duplicates ADR 0032's column and creates a second answer to "what may this workspace do", free to disagree with the first                                                                                                               |
| A free `Subscription` row created for every workspace by `afterCreateOrganization` | A row per workspace on every self-hosted instance to represent the absence of billing; "no row means free" needs no hook and no migration for existing workspaces                                                                       |
| Trusting provider webhooks with no reconcile job                                   | A missed or mis-scoped event leaves a paying customer throttled until they complain; there is nothing that notices a subscription that ended without an event                                                                           |
| Applying an event without an idempotency ledger                                    | Providers retry by design, and a retried "subscription updated" would re-run the write; the unique index is what makes replay free                                                                                                      |
| Writing `planLimits` without validating the catalogue first                        | `parseWorkspacePlanOverride` drops what it cannot parse, so a bad write grants unlimited instead of failing, and nothing reports it                                                                                                     |
| A receiver as a `@Public()` Nest controller                                        | Needs a raw-body opt-in, a throttle exemption and a guard exemption, and would join the versioned API surface that the provider's contract has no business in                                                                           |
| Suspending or deleting data on non-payment                                         | The product cannot tell a lapsed customer from a provider outage, and refusing new writes is reversible where deleting a board is not                                                                                                   |
| A separate `GET /workspaces/{id}/subscription` endpoint                            | A third read surface for plan state, where ADR 0032 deliberately settled on two; the plan identity is additive on the existing one                                                                                                      |
| `PAT_MAX_TOKENS` and `PAT_MAX_LIFETIME_DAYS` as environment knobs                  | Adds two documented variables and a `/config` field for a hosted-only concern; ADR 0028 says paid differences are quantities, and the catalogue is where quantities live                                                                |
| Taking the advisory lock now, ahead of billing                                     | Silently contradicts ADR 0027's written rejection for deployments whose ceilings are still operator guard-rails; the trigger is a paid plan, so it ships with one                                                                       |
