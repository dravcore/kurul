# Phase 8 — Deferred follow-ups

**Date:** 2026-08-09 · **Status:** open · **Parent:** [phase-8 design](2026-08-09-phase-8-activity-notifications-design.md) (when written)

Decisions locked for Phase 8 MVP, with explicitly deferred alternatives so they are not
re-litigated mid-implementation. Pick these up only when the MVP is shipped and a need appears.

## Notification centre UI

**Shipped in Phase 8:** shell bell + popover (unread badge, mark all read, deep-link to task).

| Deferred                         | Notes                                         |
| -------------------------------- | --------------------------------------------- |
| ~~Full `/notifications` page~~   | **Shipped** — cursor list, unread/type filters, mark read |
| ~~Popover + “View all” → full page~~ | **Shipped** — hybrid bell + `/notifications` |

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

| Item                                          | Where                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Email delivery of notifications               | Roadmap Phase 8 `[-]` / Beyond MVP                                                          |
| Realtime push of new notifications / activity | Phase 9 Socket.io                                                                           |
| ~~Completion-over-time dashboard series~~     | **Shipped** — 14-day created vs completed (Done column) on dashboard summary / Recharts     |

## How to use this file

When opening a follow-up issue or PR, link here and strike through rows as they ship. Do not
expand Phase 8 scope mid-PR to absorb deferred rows without an explicit decision.
