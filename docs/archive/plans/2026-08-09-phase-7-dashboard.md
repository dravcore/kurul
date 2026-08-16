# Phase 7 — Dashboard — Implementation Plan

> **Historical plan — shipped. Do not re-execute.** Checkboxes are a frozen record. Ignore any AI attribution footers in this file.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [docs/archive/specs/2026-08-09-phase-7-dashboard-design.md](../specs/2026-08-09-phase-7-dashboard-design.md)

**Goal:** Workspace aggregate view — total/overdue tiles, priority and assignee charts, optional per-board column chart — above the existing board list on `/dashboard`.

**Architecture:** One read endpoint `GET /workspaces/:workspaceId/dashboard/summary?boardId?` returns `DashboardSummaryDto`. Web loads summary + boards; board filter in URL. Completion time series deferred to Phase 8.

**Tech Stack:** NestJS DashboardModule, Prisma groupBy/count, `@kurul/shared-types`, Next.js App Router, Recharts, design.md §8, next-intl.

## Global Constraints

- `WorkspaceGuard`; GUEST+ may read. No Activity / realtime.
- English strings only via `apps/web/messages/en.json`.
- Chart colors from design tokens / priority scale — no raw hex in components.
- Branch from Phase 6 work (`feat/phase-6-filtering`) or `develop` after Phase 6 merges. Conventional Commits. Stacked PRs: API → web → docs.

---

## File map

**Create:** `dashboard-query.dto.ts`, `dashboard.service.spec.ts`, `dashboard.e2e-spec.ts`, `components/dashboard/*` (summary, stat-tile, priority/assignee/column charts, chart-table-toggle)

**Modify:** `packages/shared-types` entities, dashboard controller/service/module, `apps/web/app/(app)/dashboard/page.tsx`, `en.json`, roadmaps, CHANGELOG

---

### Task 1: Shared types + summary API

**Files:**

- Modify: `packages/shared-types/src/entities.ts`
- Create: `apps/api/src/dashboard/dto/dashboard-query.dto.ts`
- Modify: `apps/api/src/dashboard/dashboard.service.ts`, `dashboard.controller.ts`, `dashboard.module.ts`

- [ ] **Step 1:** Add `DashboardSummaryDto` and row interfaces to shared-types; rebuild package
- [ ] **Step 2:** Implement `DashboardQueryDto` (`boardId?:` UUIDv7) and `summary(workspaceId, query)` with parallel Prisma counts/groupBys per spec
- [ ] **Step 3:** Wire `GET summary` + `WorkspaceGuard`
- [ ] **Step 4:** Unit tests for zero-fill, top-8+Other, `byColumn` null vs filled, missing board → 404
- [ ] **Step 5:** E2E assert numbers, board scope, foreign board 404, 401 anonymous
- [ ] **Step 6:** Commit `feat(api): Phase 7 dashboard summary aggregations`

### Task 2: Web dashboard charts

**Files:**

- Create: `apps/web/components/dashboard/*.tsx`
- Modify: `apps/web/app/(app)/dashboard/page.tsx`, `apps/web/messages/en.json`

- [ ] **Step 1:** i18n keys (tiles, charts, empty, table toggle, board filter)
- [ ] **Step 2:** Fetch summary; board select ↔ `?boardId=` (Suspense if `useSearchParams`)
- [ ] **Step 3:** Stat tiles + Recharts bars (priority, assignee, column when present) + view-as-table
- [ ] **Step 4:** Empty (`totalTasks === 0`) and loading skeletons; keep `BoardList` below
- [ ] **Step 5:** Lint/typecheck/build web; commit `feat(web): Phase 7 dashboard charts`

### Task 3: Docs closeout

- [ ] Mark Phase 7 done in `docs/roadmap.md` + `docs/tr/roadmap.md`
- [ ] CHANGELOG Added entry; spec status → `shipped`
- [ ] Commit `docs: Phase 7 dashboard closeout`

## Out of scope

Completion-over-time, label charts, Activity writes, socket-driven tile updates.
