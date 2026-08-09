# Phase 8 — Deferred follow-ups

**Date:** 2026-08-09 · **Status:** archived · **Parent:**
[phase-8 design](../../specs/2026-08-09-phase-8-activity-notifications-design.md)

> **Archived.** The MVP shipped and every still-open row below has been folded into
> [roadmap.md — Beyond MVP](../../roadmap.md#beyond-mvp) (due-soon delivery alternatives,
> mentions without the picker, realtime push of notifications/activity). This file is kept for
> the historical record and for the `CHANGELOG.md` links that point at it; do not add new rows
> here — open an issue or extend the roadmap table instead.

Decisions locked for Phase 8 MVP, with explicitly deferred alternatives so they are not
re-litigated mid-implementation. Pick these up only when the MVP is shipped and a need appears.

## Notification centre UI

**Shipped in Phase 8:** shell bell + popover (unread badge, mark all read, deep-link to task).

| Deferred                             | Notes                                                     |
| ------------------------------------ | --------------------------------------------------------- |
| ~~Full `/notifications` page~~       | **Shipped** — cursor list, unread/type filters, mark read |
| ~~Popover + “View all” → full page~~ | **Shipped** — hybrid bell + `/notifications`              |

## Due-soon job runner

**Shipped in Phase 8:** BullMQ on Redis (matches tech-stack “notification queue”).

| Deferred                         | Notes                                                           |
| -------------------------------- | --------------------------------------------------------------- |
| In-process Nest interval scanner | Simpler ops for single-replica; fallback if BullMQ proves heavy |
| External cron → internal HTTP    | Self-hosters who prefer OS cron over an in-app worker           |

## Mentions

**Shipped in Phase 8:** structured `@[Name](userId)` in comment body + member picker.

| Deferred                                     | Notes                                               |
| -------------------------------------------- | --------------------------------------------------- |
| Plain `@DisplayName` regex                   | Fragile; only if picker is blocked                  |
| API-only `mentionedUserIds[]` without picker | Useful for scripts; not a substitute for product UX |

## Out of Phase 8 entirely (already on roadmap)

| Item                                          | Where                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| Email delivery of notifications               | Roadmap Phase 8 `[-]` / Beyond MVP                                                      |
| Realtime push of new notifications / activity | Beyond MVP (Phase 9 shipped board sync only)                                            |
| ~~Completion-over-time dashboard series~~     | **Shipped** — 14-day created vs completed (Done column) on dashboard summary / Recharts |

## How to use this file

This file is archived — see the banner at the top. It is kept for historical context and
stable `CHANGELOG.md` links, not as a place to track new follow-up work; use
[roadmap.md — Beyond MVP](../../roadmap.md#beyond-mvp) or a GitHub issue instead.
