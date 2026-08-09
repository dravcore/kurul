# Architecture Decision Records

Lightweight, MADR-style records of the significant decisions behind Kurultay.

> 🌐 English (canonical) | [Türkçe](../tr/decisions/README.md)

## Why ADRs

Kurultay is built by a small team (often solo) before and during active
development. Decisions like "why Prisma over Drizzle" or "why AGPL" get made
once, with real trade-offs weighed, and then forgotten unless they're written
down. An ADR captures the context, the decision, and the reasoning at the
moment it was made, so a future contributor (including a future us) doesn't
have to reconstruct the reasoning from a Slack thread or reopen a settled
debate. These are intentionally short and factual, not design documents.

## Index

| #                                         | Title                                                                | Status   | Date       |
| ----------------------------------------- | -------------------------------------------------------------------- | -------- | ---------- |
| [0001](0001-monorepo-modular-monolith.md) | Monorepo + Modular Monolith                                          | Accepted | 2026-08-08 |
| [0002](0002-backend-stack.md)             | Backend Stack: NestJS + Prisma + PostgreSQL + Redis                  | Accepted | 2026-08-08 |
| [0003](0003-frontend-stack.md)            | Frontend Stack: Next.js + Tailwind + shadcn/ui + @dnd-kit + Recharts | Accepted | 2026-08-08 |
| [0004](0004-auth-better-auth.md)          | Auth: Better Auth with Organization Plugin                           | Accepted | 2026-08-08 |
| [0005](0005-realtime-socketio.md)         | Realtime: Socket.io + Redis Adapter                                  | Accepted | 2026-08-08 |
| [0006](0006-fractional-indexing.md)       | Fractional Indexing for Task and Column Position                     | Accepted | 2026-08-08 |
| [0007](0007-license-agpl.md)              | License: AGPL-3.0                                                    | Accepted | 2026-08-08 |
| [0008](0008-git-flow-semver.md)           | Git Flow + Conventional Commits + SemVer                             | Accepted | 2026-08-08 |

A status can later change to **Superseded**, with a link to the ADR that
replaces it (e.g. `**Status:** Superseded by [0012](0012-....md)`).

## Adding a new ADR

1. Copy the template below into a new file: `docs/decisions/NNNN-kebab-title.md`,
   where `NNNN` is the next zero-padded four-digit number in sequence.
2. Fill in every section — leave nothing as a placeholder.
3. Add a row to the index table above.
4. Open a PR. Discussion happens on the PR; once merged, the ADR's status is
   `Accepted` and the record is treated as historical (edit later decisions by
   superseding, not by rewriting history).

## Template

```markdown
# NNNN. Title

**Status:** Proposed | Accepted | Superseded by [NNNN](NNNN-file.md)
**Date:** YYYY-MM-DD

> 🌐 English (canonical) | [Türkçe](../tr/decisions/NNNN-kebab-title.md)

## Context

What problem or question forced this decision? What constraints applied?

## Decision

The choice made, stated plainly in one or two sentences.

## Rationale

Why this option, over the others, given the context above.

## Consequences

What this makes easier, what it makes harder, and any negative trade-offs —
stated honestly, not just the upside.

## Alternatives considered

| Alternative | Why not |
| ----------- | ------- |
| ...         | ...     |
```
