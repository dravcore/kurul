# Phase 8 — Activity and notifications — Implementation Plan

> **For agentic workers:** Use executing-plans or subagent-driven-development. Spec:
> [docs/specs/2026-08-09-phase-8-activity-notifications-design.md](../specs/2026-08-09-phase-8-activity-notifications-design.md).
> Deferred: [docs/archive/specs/2026-08-09-phase-8-deferred.md](../specs/2026-08-09-phase-8-deferred.md)
> (archived).

**Goal:** Append-only activity on task mutations; in-app notifications for assignment, mention, and due-soon (BullMQ); panel timeline + shell bell.

**Architecture:** Activity rows written in the same Prisma transaction as mutations. Assignment/mention notifications inserted synchronously with those writes. Due-soon via BullMQ repeatable job on Redis. Web: mention markup in comments, history timeline, notification popover.

**Tech stack:** NestJS, Prisma, BullMQ + ioredis, existing Redis from Compose, Next.js, next-intl.

## Global constraints

- UUIDv7 ids; cursor pagination on notification/activity lists; workspace scoping
- Never notify the acting user; due-soon → assignees only
- English UI via `en.json`; no email; no socket push
- Branch `feat/phase-8-activity-notifications` from `develop`

---

### Task 1: Schema + shared types

- [ ] Add `Notification` model + migration; extend `ActivityDto` with author; add `NotificationDto` + activity type constants in shared-types
- [ ] Commit `feat(db): add Notification model for Phase 8`

### Task 2: Activity writes + feed API

- [ ] `ActivityService.record(...)` used inside task/comment/assignee transactions
- [ ] `GET .../activities` and `GET .../tasks/:taskId/activities` cursor pages
- [ ] Unit/e2e: create/move/comment produce activities; tenant isolation
- [ ] Commit `feat(api): activity log writes and feeds`

### Task 3: Notifications API + assign/mention fan-out

- [ ] Create notification on assign + on comment mentions (parse `@[Name](userId)`)
- [ ] List / unread-count / read / read-all
- [ ] E2E coverage
- [ ] Commit `feat(api): in-app notifications for assign and mention`

### Task 4: BullMQ due-soon worker

- [ ] Add `bullmq` dependency; wire Redis; register repeatable job; idempotent `due_soon` inserts
- [ ] Commit `feat(api): BullMQ due-soon notification worker`

### Task 5: Web — timeline, mentions, bell

- [ ] Comment mention picker + render; panel History; shell NotificationBell popover
- [ ] Commit `feat(web): activity timeline, mentions, notification centre`

### Task 6: Docs closeout

- [ ] Roadmap EN/TR, CHANGELOG, spec status shipped
- [ ] Commit `docs: Phase 8 closeout`
