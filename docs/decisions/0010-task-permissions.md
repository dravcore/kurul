# 0010. Task Permissions

**Status:** Accepted
**Date:** 2026-08-09

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0010-task-permissions.md)

## Context

Phase 4 lands task CRUD and drag-and-drop moves. [ADR 0009](0009-board-column-permissions.md)
explicitly deferred task authorization so board/column structure rules would not
be reopened. We need a Nest `@Roles` matrix before handlers ship, aligned with
the product stance that **members do content work; admins own board shape**.

## Decision

Task authorization is enforced in Nest with `@Roles`:

| Action                                  | OWNER | ADMIN | MEMBER | GUEST |
| --------------------------------------- | :---: | :---: | :----: | :---: |
| Read tasks                              |   ✓   |   ✓   |   ✓    |   ✓   |
| Create task; update title / description |   ✓   |   ✓   |   ✓    |   —   |
| Move task (within or across columns)    |   ✓   |   ✓   |   ✓    |   —   |
| Delete task                             |   ✓   |   ✓   |   ✓    |   —   |

Column create / rename / reorder / delete remains OWNER/ADMIN only (ADR 0009).

## Rationale

- Moving and editing cards is everyday member work on a kanban board; locking it
  to Admin+ would contradict ADR 0009’s “members do content” rationale.
- Deleting a single task is reversible enough (unlike deleting a board) that
  MEMBER may do it; guests stay read-only everywhere.
- Keeping the matrix flat (no “own tasks only”) avoids authorship checks and
  matches small-team OSS usage until a later ADR needs finer rules.

## Consequences

- Controllers use `@Roles(OWNER, ADMIN, MEMBER)` for all task mutations.
- Web UI gates via `canMutateTasks(role)` mirroring this matrix.
- Assignees, labels, comments, and other Phase 5+ surfaces inherit the same
  default unless a later ADR narrows them.
- Better Auth organization AC is not extended for `task`; Nest remains the
  product authorization layer.

## Alternatives considered

| Alternative                                          | Why not                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| Admin-only task moves                                | Breaks everyday kanban for MEMBER; too close to column-structure rules |
| MEMBER may edit/move but only OWNER/ADMIN may delete | Extra mental model for little security gain on a soft-delete-less MVP  |
| Author-only edit/delete                              | Requires `createdById` checks on every path; overkill for Phase 4      |
