# 0032. Plan Limits: One Resolver for Every Ceiling, Unlimited Until Configured

**Status:** Accepted
**Date:** 2026-08-23

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0032-plan-limits.md)

## Context

[ADR 0028](0028-open-contributions-hosted-service.md) settled where revenue comes from: a hosted
service, free within published limits, paid above them, where the limits are "operational
quantities (seats, boards, storage, similar), not features". It also named the consequence for
this repository in a sentence: the product has to grow a plan-limit layer, in the open code, that
a self-hoster can set to whatever they want or leave off entirely.

Exactly one ceiling exists today. [ADR 0027](0027-attachment-quotas.md) caps attachment bytes per
workspace and per instance, reads them from the environment, and refuses an over-limit upload
with a `413` whose `error` field is its own. Nothing caps a count: an instance accepts any number
of accounts, any number of workspaces, a workspace accepts any number of members and any number
of boards. A hosted plan cannot be expressed at all, and a self-hoster who wants a bounded
instance has no setting to reach for.

The question this ADR answers is not "should there be limits" (0028 answered that) but what
shape they take: where the numbers live, what "unset" means, where they are enforced, and what a
refused write says.

## Decision

**One object answers every ceiling question, and the byte quotas are members of it.**
`PlanLimitsService` resolves seats and boards per workspace, workspaces and accounts per
instance, and the ADR 0027 attachment quotas, through the same resolver. The quotas keep their
environment variable names, their `413`, and their `error: "Attachment Quota Exceeded"`. What
changes is that the per-workspace one is now resolvable per workspace, so a plan can raise or
lower it for one tenant. There is no second configuration pattern to learn: the plan layer wraps
the quota, it does not replace or rename it.

**Four new instance variables, each unlimited when unset.**

| Variable                        | Caps                                                      |
| ------------------------------- | --------------------------------------------------------- |
| `PLAN_MAX_SEATS_PER_WORKSPACE`  | Members **plus pending invitations** in one workspace     |
| `PLAN_MAX_BOARDS_PER_WORKSPACE` | Boards in one workspace                                   |
| `PLAN_MAX_WORKSPACES`           | Workspaces on the instance                                |
| `PLAN_MAX_USERS`                | Accounts on the instance (anonymised tombstones excluded) |

`0` is the explicit spelling of unlimited, as it already is for the byte quotas and the retention
windows; a negative or non-integer value is refused at boot, where `readInstancePlanLimits()` runs
from `PlanLimitsService.onModuleInit` and logs one `Plan ceilings: …` line whatever the values
are.

**Unset is unlimited, and this deliberately diverges from ADR 0027's 2026-08-21 update.** The
byte quotas grew default numbers because an unbounded disk takes Postgres down with it on the
published Compose topology, where the operator who never read the quota section was the
operator whose database died. No count has that property. A tenth board costs a row; a hundredth account
costs a row. The failure mode a default would prevent does not exist, and the failure mode a
default would _create_ is real: an upgrade that starts refusing the eleventh member of an
existing team is a regression nobody configured. So the layer is inert until an operator states
a number, and an instance that never sets one runs exactly the code paths it ran before, query
for query: the assertions issue no count when the ceiling is `null`.

**A seat is a member or an invitation still pending.** Counting members alone would make the
ceiling advisory: an admin at the limit could send twenty invitations and watch them all be
accepted. It would also move the refusal from the person who can act on it (the admin, who can
revoke an invitation or remove a member) to the person who cannot (the invitee, clicking a link
they were sent days ago). Pending is the same predicate the invitation list already uses,
`status = 'pending'` and unexpired, so a seat frees itself by the clock with no sweep, and what
the settings screen shows as revocable is exactly what the count charges for. At **accept** time
the count is members only: the invitation being accepted is already holding its seat, and
counting both would refuse the last seat of a workspace that has room for exactly the person
walking through the door.

**Per-workspace overrides live in `Workspace.planLimits`, a nullable JSON column.** Absent key =
defer to the instance; `null` = unlimited; `0` = unlimited; a number = that ceiling. Understood
keys are `seats`, `boards`, `storageBytes`. Resolution is override, then instance environment,
then unlimited.

**Enforcement is at the write, one refusal shape.** Board creation checks inside the transaction
that inserts the board. Workspace creation, invitation, acceptance and sign-up check immediately
before the write they guard. Each refuses with `403` and:

```jsonc
{
  "statusCode": 403,
  "error": "Plan Limit Exceeded",
  "message": "This workspace has no seats left on its plan",
  "planLimit": { "code": "PLAN_LIMIT_SEATS", "limit": 10, "current": 10 },
  "path": "/workspaces/…/invitations",
  "timestamp": "…",
  "requestId": "…",
}
```

`planLimit` is the second optional member of the error envelope, after `details`, and it exists
for the same reason: "you cannot do that" is not actionable, "you are using 10 of 10 seats" is.
The codes are `PLAN_LIMIT_SEATS`, `PLAN_LIMIT_BOARDS`, `PLAN_LIMIT_WORKSPACES` and
`PLAN_LIMIT_USERS`.

**Two read surfaces.** `GET /config` publishes the instance ceilings beside `mailEnabled` and
`attachmentsEnabled`, as deployment capability identical for every caller. `GET
/workspaces/{workspaceId}/plan` publishes one workspace's _resolved_ ceilings and current usage,
readable by any member, which is what lets the members screen say "7 of 10 seats used" and the
board list disable its create control at the ceiling with a sentence rather than a silent 403.

## Rationale

**Why `403` and not a status of its own.** This is ADR 0027's move one status along. The quota
reused `413`, already taken by the per-file size limit, and told the two apart by the envelope's
`error`, because the status alone could not say which fix to suggest. Here `403` is already taken
by "your role is too low", and a ceiling needs the opposite advice: no role change helps, someone
has to free a seat or raise a number. The status stays the honest one (authenticated,
understood, refused) and the `error` field carries the distinction, exactly as
`docs/api-conventions.md` says clients should branch. `402 Payment Required` was rejected: this
code ships to self-hosters who have no payment relationship with anybody, and an operator capping
their own instance at 20 seats is not being asked for money. A hosted deployment can map this
envelope to an upgrade prompt from `planLimit.code` without the API having to lie about what
happened.

**Why a JSON column and not a `WorkspacePlan` table.** The row that will write this does not
exist yet: hosted billing (ADR 0028) assigns a plan whose shape is still being designed, and the
requirement stated for this layer was that billing must be able to write a workspace's ceilings
_without a migration_. A typed table makes every new ceiling a migration, and there will be new
ceilings: 0028's own list ends in "similar". The JSON column takes a new key the day the
resolver learns to read it, and an older reader ignores keys it does not know instead of
failing. What billing needs beyond ceilings (plan name, provider ids, period end) is a table
0028 will add for its own reasons; that is orthogonal to this column, and keeping the two apart
means a self-hosted instance with no billing at all still has a working override mechanism.

**Why a malformed override is ignored rather than refused.** Environment is configuration and a
bad value there is refused at boot, where exactly one person sees it and nothing is running yet.
The column is _data_, written by an integration, and refusing to serve a workspace because one
JSON value is unparseable would turn a bad write into an outage for that tenant. Unusable keys
are dropped, and the ceiling falls through to the instance's own number, which is the answer the
workspace would have had before anyone wrote the row.

**Why the counts are taken at the write and not held in a counter.** ADR 0027 answered this for
bytes and the answer is the same for rows: `Workspace → Board → Task` cascades entirely inside
Postgres with no application code running, so a denormalized counter drifts on exactly the paths
that free the most. Counting live rows is correct by definition after any cascade, and no index
is added for it (the measure-first precedent of ADR 0020): every count is either by primary key
or on a column already indexed as a foreign key, and none of them runs on an unconfigured
instance.

**Why sign-up is refused at the Better Auth mount.** `/auth/*` is served by raw Express below
the Nest router (ADR 0004), so no exception filter is listening there. That is why the
organization firewall in the same file already writes its own envelope by hand. The alternative,
a `databaseHooks.user.create.before` hook, would cover every account-creating path there could
ever be, but can only refuse by throwing Better Auth's `APIError`, whose body is not the one
error envelope `docs/api-conventions.md` promises. `emailAndPassword` is the only sign-up path
enabled today, so the two placements cover the same requests; the trigger to move the check into
the hook is the first additional path (a social provider, a magic link). A ceiling refuses
sign-**up** only: signing in, verifying an address and everything else stay open at any count, so
lowering `PLAN_MAX_USERS` under an instance's own population never locks anybody out.

## Consequences

- **The ceilings are soft, and bounded.** Only the board check shares a transaction with its
  write, and even that one is read-committed: two simultaneous creates can each count `n`. The
  overshoot is bounded by the number of simultaneous requests, which is ADR 0027's accepted trade
  in the same words. **Trigger:** a report of a ceiling being raced deliberately, or a measured
  overshoot beyond one write per concurrent request. **Cost when triggered:** a
  `pg_advisory_xact_lock` keyed on the workspace id around the count and the insert.
- Workspace creation and invitation cannot share a transaction with their write at all: both
  writes belong to Better Auth's API, not to a Prisma call this code makes. The window is one
  round trip.
- `.env.example`, `docs/self-hosting.md`, `docs/api-conventions.md` and their Turkish mirrors
  gain the four variables, the error code table and the two read surfaces.
- The web branches on `PLAN_LIMIT_ERROR` in the create-board and invite dialogs, and reads
  `GET .../plan` on the boards and members screens. A failed plan read fails **open**: the
  control stays enabled, because the API refuses the write on its own and one refused request is
  a smaller harm than a workspace that cannot create a board and is told nothing about why.
- Hosted billing (ADR 0028) now has its enforcement point. Assigning a plan is writing
  `Workspace.planLimits`; nothing else in the product has to know that money was involved.

## Alternatives considered

| Alternative                                               | Why not                                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Default numbers, as the byte quotas now have              | No count can take an instance down the way a full disk can; a default would only break existing deployments on upgrade                    |
| A `WorkspacePlan` table with typed columns                | Makes every future ceiling a migration, which is exactly what the hosted-billing row must not need                                        |
| `402 Payment Required`                                    | Self-hosters have no payment relationship; a self-imposed ceiling is not a bill                                                           |
| A new status code, or reusing `409`                       | `403` already means "authenticated and refused"; the `error` field is the codebase's established way to say which refusal                 |
| One guard or interceptor for every ceiling                | It would have to guess which quantity a request consumes, and would not run at all on the Better Auth routes where two of the writes live |
| Counting members without pending invitations              | Makes the seat ceiling advisory, and moves the refusal to the invitee who cannot act on it                                                |
| Counting pending invitations at accept time too           | Refuses the last seat of a workspace that has room for exactly that person                                                                |
| Renaming the attachment quota variables into `PLAN_MAX_*` | Breaks every existing `.env` for a naming symmetry nobody asked for; the plan layer reads the quotas, it does not own them                |
| Denormalized usage counters                               | Cascade deletes run entirely inside Postgres, so the counter drifts on the paths that free the most (ADR 0027's finding, unchanged)       |
