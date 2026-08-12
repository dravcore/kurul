# 0001. Monorepo + Modular Monolith

**Status:** Accepted
**Date:** 2026-08-08

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0001-monorepo-modular-monolith.md)

## Context

Kurultay is pre-skeleton: no code exists yet, so both the code-organization axis
(monorepo vs. polyrepo) and the runtime axis (monolith vs. microservices) must be
decided before the first line is written. The two axes are independent — how code
is _stored_ is not how it _runs_ — and both need an explicit answer.

## Decision

**Monorepo** (pnpm workspace: `apps/api`, `apps/web`, `packages/shared-types`, and
later `packages/auth-access` for Better Auth organization AC) for
code organization, and a **modular monolith** for runtime: one NestJS process with
clean module boundaries (auth, workspace, board, task, dashboard, notification, …).
No microservices at this stage.

## Rationale

- Frontend and backend share TypeScript, so `packages/shared-types` carries
  task/board types across the boundary — a data model change updates in one place.
- Solo/small-team velocity: two repos means duplicate PRs and version-sync overhead
  for no benefit yet.
- Lower OSS contribution barrier: one clone, one `docker compose up`.
- Reference projects mostly ship as monorepos (Plane, Huly).
- Microservices were rejected: they add distributed-system complexity (inter-service
  calls, distributed transactions, separate deploy pipelines, observability) in
  exchange for independent scaling the MVP doesn't need.
- Kanban is tightly coupled: moving a task touches the task row, activity log,
  notifications, and dashboard aggregates together — splitting this across services
  turns one transaction into a distributed one.
- The data model isn't settled yet. Drawing service boundaries too early risks
  cutting in the wrong place, which is far more expensive to fix than splitting a
  monolith later once the shape is known.

**Staged evolution path:** single NestJS process at MVP → same codebase split into
`api` / `ws` (Socket.io) / `worker` (queue) roles running from the same image once
traffic demands it → extract only a proven bottleneck into its own service if that
day ever comes.

**Reference projects:** Plane (monolith + two support services — a DB-proxy
Gateway and an integration Pilot), Linear (single codebase, different workload
roles — WebSocket servers, GraphQL API, job runners — each independently
scalable), Huly (monorepo + multi-service, but had to build its own build
system, Rush, to manage it).

## Consequences

- Single deploy artifact, simpler onboarding, one code style, no cross-package
  version skew.
- Module boundaries must stay clean from day one — this discipline is what makes
  the later split cheap; sloppy boundaries make it expensive again.
- The whole app scales as one unit until roles are split out.
- A defect in one module can affect the availability of the whole process.

## Alternatives considered

| Alternative                       | Why not                                                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Polyrepo (separate api/web repos) | Duplicate PR/version-sync overhead for a solo/small team; harder for OSS contributors to run locally                                                  |
| Microservices from day one        | Distributed complexity with no scaling need yet; kanban's transactions are tightly coupled; data model unsettled, so boundaries would likely be wrong |
