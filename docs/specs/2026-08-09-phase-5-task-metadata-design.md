# Phase 5 — Task metadata — design

**Date:** 2026-08-09 · **Status:** shipped · **Scope:** api label/comment/task metadata + web panel/cards

## Goals

Assignees, board labels (slot colors), priority, dueDate, estimatedMinutes, comments — API and UI.

## Permissions

[ADR 0011](../decisions/0011-label-task-metadata-permissions.md). Task field/assignee/comment mutate stays MEMBER+ ([ADR 0010](../decisions/0010-task-permissions.md)); label CRUD Admin+.

## Non-goals

Filters (Phase 6), activity log (Phase 8), realtime (Phase 9).

## API

- Labels: `GET/POST .../boards/:boardId/labels`; `PATCH/DELETE .../labels/:labelId`
- Assignees: `POST/DELETE .../tasks/:taskId/assignees[/:userId]`
- Task labels: `POST/DELETE .../tasks/:taskId/labels[/:labelId]`
- Comments: `GET/POST .../tasks/:taskId/comments`; `DELETE .../comments/:commentId`
- `PATCH .../tasks/:taskId` — `priority`, `dueDate`, `estimatedMinutes` (+ title/description)

`TaskDto` includes `assignees[]` and `labels[]`. `CommentDto` includes author name/avatar.

## Web

Panel: editors for all metadata + comment thread. Card: priority icon + title · label dots · meta row (design.md §4).

## Sequencing

API → panel → card chrome → docs.
