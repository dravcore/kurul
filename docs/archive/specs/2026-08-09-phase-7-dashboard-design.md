# Phase 7 — Dashboard — design

**Date:** 2026-08-09 · **Status:** shipped · **Scope:** workspace dashboard summary API + Recharts UI

## Goals

Workspace-level aggregate view: counts and charts so members see load at a glance, then open
boards. Charts sit above the existing board list on `/dashboard`.

## Permissions

Read-only. Any workspace member (including GUEST) may call the summary endpoint
([ADR 0010](../../decisions/0010-task-permissions.md) — no new mutate roles).

## Non-goals

- Completion / created-vs-completed over time (needs Activity — Phase 8)
- Label distribution chart (not on the roadmap checklist)
- Realtime chart refresh (Phase 9)
- Moving board list off `/dashboard`

## Locked decisions

| Topic                   | Choice                                                                   |
| ----------------------- | ------------------------------------------------------------------------ |
| Completion time series  | Deferred to Phase 8                                                      |
| Page layout             | Charts above, `BoardList` below on `/dashboard`                          |
| Column / “status” chart | Only when `?boardId=` is set; workspace-wide column merge by name is out |
| API shape               | Single `GET .../dashboard/summary`                                       |

## API

```
GET /workspaces/:workspaceId/dashboard/summary?boardId=
```

`WorkspaceGuard`. Optional `boardId` must belong to the workspace; else `404`.

**`DashboardSummaryDto`** (`@kurultay/shared-types`):

| Field          | Meaning                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `totalTasks`   | Task count in scope (workspace or board)                                                                                                      |
| `overdueCount` | `dueDate` not null and `dueDate < now` (UTC)                                                                                                  |
| `byPriority`   | `{ priority, count }[]` for all `Priority` values (zeros included)                                                                            |
| `byAssignee`   | Top 8 by count, then `{ userId: null, name: "Other", count }` if needed; unassigned as `{ userId: null, name: "Unassigned", count }` when > 0 |
| `byColumn`     | `null` without `boardId`; else `{ columnId, name, position, count }[]` ordered by column `position`                                           |

Queries: Prisma `count` / `groupBy` scoped via `board.workspaceId` (and `boardId` when set).
Reuse Phase 6 indexes; no N+1. Unknown query keys → `400`.

## Web

- Filter row: board select (`All boards` / one board) synced to URL `?boardId=`
- Stat tiles: total tasks + overdue ([design.md](../../design.md) §8)
- Recharts: priority horizontal bar; assignee horizontal bar (top 8 + Other); column bar when board selected
- Each chart: “View as table” toggle; loading skeletons; empty state when `totalTasks === 0` (Damga + copy per design.md §6)
- Keep `BoardList` below; all strings via `en.json`

## Sequencing

Spec → API + tests → web charts → docs closeout. Land on top of Phase 6 (`feat/phase-6-filtering` or `develop` after merge).
