# 0017. Partial Indexes Live in Migrations, Guarded by Tests

**Status:** Accepted
**Date:** 2026-08-12

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0017-partial-indexes-outside-prisma-schema.md)

## Context

Due-soon reminders are written by a scheduled worker
(`notification/due-soon.worker.ts`) that re-scans every task approaching its due date on each
tick. Without deduplication the same unread reminder is rewritten every tick, so the worker
uses `createMany({ skipDuplicates: true })`.

That flag compiles to `INSERT … ON CONFLICT DO NOTHING`. Its entire effect depends on a
unique index existing for the rows to conflict on — **with no index, the clause is a silent
no-op and every insert succeeds.** The index it needs is deliberately partial:

```sql
CREATE UNIQUE INDEX "Notification_due_soon_unread_uidx"
ON "Notification" ("userId", "taskId")
WHERE "type" = 'due_soon' AND "readAt" IS NULL AND "taskId" IS NOT NULL;
```

The predicate is load-bearing. A plain `@@unique([userId, taskId])` would forbid two mentions
on one task, and would forbid ever re-notifying a task whose earlier reminder was already
read. Only the filtered form says what is actually meant: _one unread due-soon reminder per
user per task_.

**Prisma's schema language cannot express a `WHERE` on an index.** So the index exists only
in `migrations/20260809180000_due_soon_perf_indexes/migration.sql`. From
`schema.prisma`'s point of view it is an object nobody declared — which is exactly what
`prisma migrate dev` calls drift. A future schema change can therefore generate a migration
that drops it, and the developer running the command sees a routine index removal in a diff
full of other index churn.

The failure that follows is silent and delayed: no error, no failing request, just
`skipDuplicates` quietly doing nothing and users watching one task fill their notification
list one scheduler tick at a time.

## Decision

Partial indexes stay in raw SQL migrations — there is no alternative — and each one is
**guarded by an integration test that asserts the index exists in `pg_indexes` and that the
behaviour depending on it still holds.**

`test/due-soon-index.e2e-spec.ts` does this for `Notification_due_soon_unread_uidx`: it
checks the index is present and unique, that its predicate still names `due_soon`,
`readAt IS NULL` and `taskId IS NOT NULL` over `("userId", "taskId")`, and then exercises the
consequences — a repeated unread reminder collapses to one row, a re-notification after a
read does not, and other notification types still repeat freely.

Any future partial index adopts the same pattern.

## Rationale

- **The test is the only mechanical guard there is.** The schema comment on the
  `Notification` model says "do not let a generated migration drop it", but a comment does
  not run in CI. A dropped index turns three of the five tests in that file red immediately —
  verified by dropping it against a live test database.
- **Asserting the predicate, not just the name, is the point.** An index that survives with a
  widened `WHERE` is worse than a missing one: it starts rejecting legitimate rows (a second
  mention) rather than merely failing to reject duplicates.
- **Behavioural assertions outlast the definition string.** If Postgres ever reformats
  `indexdef`, the three behaviour tests still fail for the right reason. The definition
  assertions are there to name _which_ invariant broke.
- **These tests belong in the integration tier.** They are meaningless against a mocked
  Prisma client — the object under test is a database object. `docs/testing.md` already puts
  "test the API against a real PostgreSQL" at the centre of the strategy, and this is the
  purest example of it.

## Consequences

- A generated migration that drops the index fails CI at the integration step rather than
  reaching production. The fix is to edit the generated migration and keep the
  `CREATE UNIQUE INDEX`, not to relax the test.
- The index definition is asserted in two places — the migration and the test — so an
  intentional change to the predicate has to be made twice. That duplication is the point;
  it forces the change to be deliberate.
- `prisma migrate dev` will keep reporting this index as drift. That is inherent to Prisma,
  not something this ADR removes; the guard converts a silent loss into a loud one.
- The same treatment is owed to any future filtered, expression, or `CONCURRENTLY`-created
  index — anything the schema cannot round-trip. Adding one without a guard test is the
  regression this ADR is meant to prevent.

## Alternatives considered

| Alternative                                                         | Why not                                                                                                                            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A plain `@@unique([userId, taskId])` Prisma can express             | Wrong semantics: forbids a second mention on a task, and forbids re-notifying a task after its earlier reminder was read           |
| Deduplicate in the worker instead (read existing rows, then filter) | Turns one statement into a read-then-write race between concurrent scanners — precisely what a unique index resolves atomically    |
| Trust the schema comment and reviewer attention                     | A comment does not run in CI, and the drop arrives inside a generated migration full of unrelated index churn                      |
| A migration-linting step that diffs `pg_indexes` against a baseline | A larger mechanism to build and keep current; the behaviour tests catch the same loss and also explain what breaks when it happens |
| `@@index` with `map` plus a raw `ALTER`                             | Prisma still does not model the predicate, so the drift is unchanged — only the file it lives in moves                             |
