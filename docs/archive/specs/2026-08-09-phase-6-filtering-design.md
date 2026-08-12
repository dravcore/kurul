# Phase 6 — Filtering and search — design

**Date:** 2026-08-09 · **Status:** shipped · **Scope:** task list query DTO, cursor pagination, board filter bar

## Goals

Boards stay usable past a few dozen cards: server-side filters, free-text search, cursor
pagination on `GET .../boards/:boardId/tasks`, and a URL-synced filter bar on the board.

## Permissions

Read-only filters — any workspace member (including GUEST) can filter. No new mutate
permissions ([ADR 0010](../decisions/0010-task-permissions.md),
[ADR 0011](../decisions/0011-label-task-metadata-permissions.md)).

## Non-goals

Full-text ranking / `tsvector`, saved views, workspace-wide search, table/list board view,
dashboard aggregations (Phase 7), activity (Phase 8), realtime (Phase 9).

## API

`GET /workspaces/:workspaceId/boards/:boardId/tasks` returns `CursorPage<TaskDto>` (breaking
change from bare `TaskDto[]`).

| Query                          | Notes                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `limit`, `cursor`              | Default 50 / max 100; cursor is opaque `id`                                            |
| `q`                            | ILIKE on title and description                                                         |
| `priority`                     | CSV or repeated; OR within                                                             |
| `assigneeId`                   | CSV/repeated, or `null` for unassigned                                                 |
| `labelId`                      | CSV/repeated; OR within                                                                |
| `dueDate`                      | `null` for no due date                                                                 |
| `dueDate[gte]`, `dueDate[lte]` | ISO 8601 range                                                                         |
| `sort`                         | Whitelist `position`, `createdAt`, `dueDate`, `priority` (+ `-`); page walk stays `id` |

Combined filters are AND. Unknown keys → `400`. Indexes: `(boardId, priority)`,
`(boardId, dueDate)`, `(boardId, id)`.

## Web

Board client drains pages until `!hasMore`, then sorts by `position, id` for Kanban/DnD.
Filter state lives in the URL. Topbar: search + filter controls + active chips. `/` focuses
search. Empty state when filters match nothing ([design.md](../design.md) §6).

## Sequencing

Spec → API + indexes + tests → web filter UX → docs closeout.
