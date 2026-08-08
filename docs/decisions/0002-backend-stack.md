# 0002. Backend Stack: NestJS + Prisma + PostgreSQL + Redis

**Status:** Accepted
**Date:** 2026-08-08

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0002-backend-stack.md)

## Context

The backend needs a framework, ORM, database, and cache/queue layer that fit a
solo/small-team build of a realtime-leaning, multi-tenant kanban tool, and that
share types cleanly with the Next.js frontend.

## Decision

**NestJS + TypeScript**, **Prisma** as ORM, **PostgreSQL 17**, and **Redis**.

## Rationale

- Industry precedent: ClickUp runs TypeScript/NestJS/PostgreSQL/Redis (plus Kafka
  at its scale); Linear runs end-to-end Node.js/TypeScript with PostgreSQL and
  Redis as its event bus and cache.
- NestJS's modular architecture keeps a multi-module product (auth, workspace,
  board, task, dashboard, notification) organized for a solo developer or small
  team.
- Same language as the frontend enables `packages/shared-types` — task/board
  types defined once and consumed by both sides, saving real time whenever the
  data model changes.
- Most OSS PM alternatives (Plane, Taiga) use Django for fast CRUD and a free
  admin panel; end-to-end TypeScript becomes the stronger choice once realtime
  sync is a priority, which it is here.
- **Prisma over Drizzle:** both are production-ready in 2026. Drizzle offers
  SQL-close control and the smallest footprint (~7.4kb); Prisma offers a
  schema-first workflow, a mature ecosystem, and rich tooling (Prisma Studio).
  Prisma 7 dropped its Rust engine dependency, largely resolving the historical
  bundle-size complaint. Prisma's guided migrations and thorough docs save
  debugging time working solo — Drizzle's performance edge lives in the ORM
  layer, and in practice the DB round-trip (5–50ms) dwarfs that difference.
- **Postgres + Redis** is close to undisputed: both commercial peers (ClickUp,
  Linear) and OSS peers (Plane, Taiga, Focalboard) use Postgres — JSON fields
  cover flexible metadata (custom fields), relational integrity covers
  task/board relations. Redis is one tool covering four needs: notification
  queue, session store, rate limiting, and the Socket.io pub/sub adapter.

## Consequences

- Guided migrations and strong docs reduce solo-dev debugging time; Prisma
  Studio speeds up local inspection.
- Redis becomes a hard runtime dependency for basic features, not an optional
  extra.
- Prisma's schema-first flow is less flexible than raw SQL for complex queries
  when they eventually arise.
- Committing to end-to-end TypeScript forgoes Django's batteries-included admin
  panel that OSS peers get for free.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Fastify | Lighter, but lacks Nest's built-in modular DI structure — more to hand-roll for a multi-module product |
| Django | Fast CRUD + free admin panel (why Plane, Taiga chose it), but breaks end-to-end TS type sharing and fits a realtime-heavy product less well |
| Drizzle | Smaller footprint, closer to SQL, but less guided migration tooling for solo development |
