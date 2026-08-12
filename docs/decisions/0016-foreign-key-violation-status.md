# 0016. Foreign-Key Violations Map to 409, Not 422

**Status:** Accepted
**Date:** 2026-08-12

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0016-foreign-key-violation-status.md)

## Context

`AllExceptionsFilter` translates the three Prisma error codes that can escape a service into
HTTP statuses: `P2002` (unique violation) → `409`, `P2025` (record not found) → `404`, and
`P2003` (foreign-key constraint violation) → `409`. The `P2003` row had no test, and a
tech-debt audit pass proposed changing it to `422 Unprocessable Entity` on the reading that a
request naming a row that does not exist is "semantically invalid though well-formed" —
exactly the wording `docs/api-conventions.md` gives `422`.

Locking the mapping with a test first required settling which code is actually correct, since
a test written against the wrong status would cement the wrong contract rather than protect
the right one.

## Decision

`P2003` maps to **`409 Conflict`**. The audit's `422` proposal is rejected. The status is now
covered by two tests in `all-exceptions.filter.spec.ts`, which also assert that the database
constraint name never reaches the response body.

## Rationale

**Every `P2003` this schema can produce is a conflict with database state, not a fault in the
request body.** The code arrives in exactly two shapes:

- **A blocked delete.** `WorkspaceMember.user`, `Task.createdBy`, `TaskAssignee.user`,
  `Comment.user` and `Activity.user` all carry `onDelete: Restrict`. Removing a row that
  something still references raises `P2003`. The request is entirely valid; the current state
  of the database is what refuses it. That is the textbook `409` — and it is the same
  category as `P2002`, which already maps to `409`.
- **A lost race.** Services validate that a referenced row exists and is in-workspace before
  writing. A `P2003` on insert therefore means the row was deleted between the check and the
  write. Retrying may well succeed, which is what `409` communicates and what `422` denies.

**`422` in this API is a per-field answer, and the filter has no fields to give.**
`docs/api-conventions.md` documents `details` as "present only for `400`/`422`" — a `422` is
the shape a client reads field-by-field. All the filter has is Prisma's `meta.field_name`,
which is a database identifier (`Task_createdById_fkey (index)`), not a DTO path. Emitting a
`422` with no `details`, or with a `details` entry naming a schema constraint, degrades the
error contract in both directions.

**The API's real `422` case is deliberate and never comes from the filter.** The convention's
own example — moving a task to a column on another board — is checked in the service, which
raises the status itself with a proper message. Reaching the exception filter means the
app-level check was _not_ the thing that fired; treating that as a validation failure
misreports where the problem is.

**A last-resort mapping should be conservative.** The filter is a safety net for errors no
service anticipated. `409` says "state conflicted, this may be transient"; `422` says "your
input is wrong, do not retry". Of the two, telling a client its body was wrong when the truth
was a race is the more misleading failure.

## Consequences

- `docs/api-conventions.md` needs no change: "a conflicting concurrent change" already covers
  both shapes of `P2003`, and no wording there implies a foreign-key error is a `422`.
- A blocked delete answers `409 Conflict` with `"Related resource conflict"` — deliberately
  generic. It says nothing about _which_ rows still reference the target, because saying so
  across a tenant boundary would leak existence. An endpoint that wants a specific,
  actionable message (for example "reassign this member's tasks first") must check for
  dependents itself and raise its own exception; it must not lean on the filter.
- The mapping is only exercised by unit tests against the filter. No HTTP route in the API
  can be made to emit `P2003` on demand — every reachable path validates its references
  first, which is the point — so an integration test would have to fake the failure anyway.
- If a future endpoint does want a delete to explain its blockers per-field, that endpoint
  raises `422` with `details` deliberately. This ADR governs the unhandled fallback, not
  every possible foreign-key response.

## Alternatives considered

| Alternative                                       | Why not                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `422 Unprocessable Entity` (the audit's proposal) | Misreports a state conflict and a lost race as a body-validation failure, and produces a `422` with no `details` for a client to read |
| `404 Not Found` for the insert-side shape         | Cannot be distinguished from the delete-side shape at the filter; `P2025` already owns "the row you named is not there"               |
| `400 Bad Request`                                 | The body is well-formed and passed validation; the failure is in the database's state, not the request                                |
| Split `P2003` by `meta.field_name`                | Branching on Prisma constraint names couples the HTTP contract to schema naming, and both branches would still answer `409`           |
