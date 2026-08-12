# 0011. Label and Task-Metadata Permissions

**Status:** Accepted (comment-delete row superseded by
[ADR 0012](0012-comment-delete-authorship.md); all other rows still apply)
**Date:** 2026-08-09

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0011-label-task-metadata-permissions.md)

## Context

Phase 5 adds board labels, assignees, priority/due/estimate fields, and comments.
[ADR 0010](0010-task-permissions.md) already grants MEMBER+ task create/edit/move/delete.
Labels are board-scoped taxonomy (like columns), so they need a distinct gate from
“edit this card.”

## Decision

| Action                                                    | OWNER | ADMIN | MEMBER | GUEST |
| --------------------------------------------------------- | :---: | :---: | :----: | :---: |
| Read labels, assignees, comments, task metadata           |   ✓   |   ✓   |   ✓    |   ✓   |
| Create / rename / delete board labels                     |   ✓   |   ✓   |   —    |   —   |
| Assign / unassign labels on a task                        |   ✓   |   ✓   |   ✓    |   —   |
| Add / remove assignees                                    |   ✓   |   ✓   |   ✓    |   —   |
| Update `priority`, `dueDate`, `estimatedMinutes`          |   ✓   |   ✓   |   ✓    |   —   |
| Create comments; delete any comment on an accessible task |   ✓   |   ✓   |   ✓    |   —   |

> **Superseded:** the "delete any comment" half of the row above no longer holds. Comment
> delete requires authorship or OWNER/ADMIN — see [ADR 0012](0012-comment-delete-authorship.md).

`Label.color` is a `LabelColorSlot` (`slot-1`…`slot-8`), never a raw hex.

## Rationale

- Label CRUD changes the board’s vocabulary — same Admin+ stance as column structure
  ([ADR 0009](0009-board-column-permissions.md)).
- Assigning labels, people, and dates is everyday card work — MEMBER+.
- Flat comment delete avoids authorship checks for MVP; refine later if needed.

## Consequences

- Nest `@Roles` differ for label CRUD vs label assign.
- Web: `canMutateLabels` (Admin+) vs `canMutateTasks` (MEMBER+) for pickers vs label manager.
- Assignees must be workspace members; labels must belong to the task’s board.

## Alternatives considered

| Alternative                | Why not                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| MEMBER may create labels   | Pollutes board taxonomy; conflicts with column Admin                                                                 |
| Author-only comment delete | Extra checks; defer until abuse appears — **revisited and adopted in [ADR 0012](0012-comment-delete-authorship.md)** |
