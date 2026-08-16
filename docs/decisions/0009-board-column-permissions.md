# 0009. Board and Column Permissions

**Status:** Accepted
**Date:** 2026-08-09

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0009-board-column-permissions.md)

## Context

Phase 3 introduces board and column mutations under workspace tenancy. Nest
already gates product routes with `WorkspaceGuard` + `@Roles`, while Better Auth
organization statements in `@kurul/auth-access` cover org/member/invitation
only — not boards or columns. [design.md](../design.md) already ships a `403`
copy that assumes Admin access for column changes. We needed an explicit role
matrix before handlers land, so API guards and UI enablement stay aligned, and
so later task-level permissions can extend the same pattern without reopening
the board/column debate.

## Decision

Board and column authorization is enforced in Nest with `@Roles`, using this
matrix:

| Action                                        | OWNER | ADMIN | MEMBER | GUEST |
| --------------------------------------------- | :---: | :---: | :----: | :---: |
| Read boards and columns                       |   ✓   |   ✓   |   ✓    |   ✓   |
| Create board; update board name / description |   ✓   |   ✓   |   ✓    |   —   |
| Delete board                                  |   ✓   |   ✓   |   —    |   —   |
| Column create / rename / reorder / delete     |   ✓   |   ✓   |   —    |   —   |

## Rationale

- Opening boards and editing board metadata is everyday work for members;
  restricting create/update to Admin+ (Trello/Jira-unlike) adds friction for
  small teams without a real security win.
- Changing column structure is a board-shape change. The design language already
  promises “You need Admin access to change columns,” so MEMBER must not mutate
  columns.
- Deleting a board cascades columns and tasks; that destructive surface stays
  OWNER/ADMIN.
- GUEST already has an empty mutation surface in
  `packages/auth-access`; keeping guests read-only on boards matches that
  stance.

## Consequences

- Controllers must apply distinct `@Roles` sets for board create/update vs
  board delete vs column mutations; a single “member can write” gate is wrong.
- The web UI hides or disables Admin-only controls and surfaces the design.md
  `403` copy inline when a blocked control is still reachable.
- Task create/edit/move permissions land in
  [ADR 0010](0010-task-permissions.md) (MEMBER+ mutate; GUEST read-only).
- Better Auth AC statements are not extended for `board`/`column` resources;
  product authorization stays Nest-side for these domains.

## Alternatives considered

| Alternative                                                      | Why not                                                                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Admin-only for all board and column mutations                    | Too strict for small teams; board create is content work, not structure admin                                        |
| MEMBER may create/rename columns; only delete/reorder need Admin | Conflicts with design.md Admin copy for “change columns”; splits column UX into two mental models                    |
| Encode board/column statements in Better Auth organization AC    | Org plugin surface is workspace membership, not product resources; Nest already owns workspace-scoped product guards |
