# Phase 4 — Tasks and drag-and-drop — design

**Date:** 2026-08-09 · **Status:** approved · **Scope:** `apps/api` task module, `apps/web` board/task UI

## Goals

- Task CRUD scoped to workspace/board/column.
- Fractional `Task.position` moves (within and across columns) with on-demand rebalance.
- `@dnd-kit` multi-column board with optimistic move + rollback toast.
- Non-modal task detail panel (title + description only).
- ADR 0010 permissions; record `@dnd-kit` re-evaluation in ADR 0003.

## Non-goals

Assignees, labels, priority UI, due date/estimate UI, comments (Phase 5). Filters
(Phase 6). Activity/notifications (Phase 8). Realtime sockets (Phase 9).

## API

Per [api-conventions.md](../api-conventions.md):

| Method           | Path                                              | Roles                         |
| ---------------- | ------------------------------------------------- | ----------------------------- |
| GET/POST         | `/workspaces/:workspaceId/boards/:boardId/tasks`  | read: members; write: MEMBER+ |
| GET/PATCH/DELETE | `/workspaces/:workspaceId/tasks/:taskId`          | read: members; write: MEMBER+ |
| PATCH            | `/workspaces/:workspaceId/tasks/:taskId/position` | MEMBER+                       |

`MoveTaskDto`: `{ columnId, beforeTaskId?, afterTaskId? }`. Cross-board column → `422`.
Cross-tenant → `404`. Position helpers from `common/position/fractional-index`. Display
order: `position asc, id asc` (deterministic tie-break).

## Web

- Cards in `components/task/`; load board tasks with columns.
- Detail: right panel 480px (`--ease-drawer`); intercepting route
  `board/[boardId]/task/[taskId]`; sheet below 1024px.
- DnD: design.md §5 (lift, ghost, sancak insertion, keyboard sensors, toast retry).
- Keep pinned `@dnd-kit` unless blocked; document outcome in ADR 0003.

## Permissions

[ADR 0010](../decisions/0010-task-permissions.md) — MEMBER+ mutate tasks; GUEST read-only.

## Sequencing

Stacked PRs: API → UI (no DnD) → DnD → docs closeout.
