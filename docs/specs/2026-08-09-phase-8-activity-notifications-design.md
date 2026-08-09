# Phase 8 — Activity log and notifications — design

**Date:** 2026-08-09 · **Status:** shipped · **Scope:** activity writes/feeds, Notification model, BullMQ due-soon, panel timeline, mention picker, shell bell

**Deferred alternatives:** [2026-08-09-phase-8-deferred.md](2026-08-09-phase-8-deferred.md)

## Goals

Users see what changed on a task/workspace and get in-app alerts for assignment, @mention,
and due-soon. Email stays out of MVP.

## Permissions

- Activity feed: any workspace member (GUEST+) read
- Notifications: only the recipient’s own rows; mark-read self only
- Activity writes: side effect of existing MEMBER+ mutations (no separate permission)

## Non-goals

Email, Socket push (Phase 9), full `/notifications` page (see deferred doc), workspace-level
activity types beyond task events in this phase (board rename / member joined can wait).

## Locked decisions

| Topic               | Choice                                                    |
| ------------------- | --------------------------------------------------------- |
| Notification types  | `assignment`, `mention`, `due_soon`                       |
| Due-soon runner     | BullMQ on Redis; ~15m repeatable; window `(now, now+24h]` |
| Mentions            | `@[Name](userId)` in comment body + member picker         |
| Centre UI           | Shell bell + popover                                      |
| Activity write      | Same DB transaction as the mutation                       |
| Due-soon recipients | Assignees only (skip if none)                             |
| Self-notify         | Never notify the acting user                              |

## Activity

**Types (string):** `task.created`, `task.updated`, `task.moved`, `task.deleted`,
`task.assigned`, `task.unassigned`, `comment.created`.

**Payload:** JSON snippets needed to render the feed (title, column ids/names, changed
fields, assignee userId, commentId, mentionedUserIds, …) — additive, no migration per type.

**API**

| Method | Path                                                | Notes                                                                                                                                                                                                                      |
| ------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/workspaces/:workspaceId/activities`               | Workspace feed, cursor on `id`, newest first via `createdAt`+`id` or walk by `id` desc — prefer keyset on `(createdAt, id)` documented as opaque cursor encoding, or `id` desc if UUIDv7 time-order is acceptable for feed |
| GET    | `/workspaces/:workspaceId/tasks/:taskId/activities` | Task timeline                                                                                                                                                                                                              |

Response: `CursorPage<ActivityDto>` with author `{ id, name, avatarUrl }` enriched (extend
DTO if needed).

## Notification

**Model (new migration)**

```
Notification
  id, workspaceId, userId, type, taskId?, activityId?, payload Json,
  readAt DateTime?, createdAt
  @@index([userId, createdAt])
  @@index([userId, readAt])
  @@index([workspaceId])
  @@unique([userId, type, taskId, dedupeKey]) // optional; or app-level idempotency for due_soon
```

Prefer app-level idempotency for `due_soon`: before insert, exist check for same
`(userId, type, taskId)` with `createdAt` in the current due window / unread.

**API**

| Method | Path                                                             |
| ------ | ---------------------------------------------------------------- |
| GET    | `/workspaces/:workspaceId/notifications?cursor&limit&unreadOnly` |
| GET    | `/workspaces/:workspaceId/notifications/unread-count`            |
| POST   | `/workspaces/:workspaceId/notifications/:notificationId/read`    |
| POST   | `/workspaces/:workspaceId/notifications/read-all`                |

## BullMQ

- Queue `due-soon` on existing Redis; worker in API process (same deploy)
- Repeatable every 15 minutes: find tasks with `dueDate` in (now, now+24h], assignees;
  create `due_soon` if not already notified for that due window
- Document `REDIS_URL` (already present for Phase 9 prep)

## Web

- Comment composer: `@` opens member picker → inserts `@[Name](userId)`; render as mention chip
- Task panel: comments, then **History** activity timeline
- Shell: bell + unread badge + popover (mark one / mark all, deep-link to task); empty “You're caught up”

## Sequencing

Migration + types → activity service + wire mutations → notification sync (assign/mention) →
BullMQ due-soon → web timeline/mentions/bell → docs closeout.
