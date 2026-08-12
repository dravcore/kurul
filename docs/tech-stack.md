# Tech Stack

The technology chosen for each layer of Kurultay, with a short rationale and the alternative it was weighed against.

> 🌐 English (canonical) | [Türkçe](tr/tech-stack.md)

**Pins.** Majors and product choices below are the lasting decisions. Exact versions drift;
treat root and app `package.json` / `pnpm-lock.yaml` as source of truth for what is installed
today. Architecture shape: [architecture.md](architecture.md).

## Contents

- [1. Summary](#1-summary)
- [2. Rationale by layer](#2-rationale-by-layer)
- [3. Deliberately not included](#3-deliberately-not-included)
- [4. Open-source references](#4-open-source-references)
- [5. Decision records](#5-decision-records)

---

## 1. Summary

| Layer                  | Choice                                 | Alternative considered                |
| ---------------------- | -------------------------------------- | ------------------------------------- |
| Backend                | NestJS 11 + TypeScript                 | Fastify (lighter), Django             |
| Database               | PostgreSQL 18                          | —                                     |
| Cache / PubSub / Queue | Redis 8 (AGPLv3)                       | Valkey (BSD-3, Linux Foundation fork) |
| ORM                    | Prisma 7                               | Drizzle ORM                           |
| API                    | REST (initially)                       | GraphQL (later)                       |
| Realtime               | Socket.io + `@socket.io/redis-adapter` | `ws` (lighter, no features)           |
| Frontend               | Next.js 16 + React + TypeScript        | —                                     |
| Styling                | Tailwind CSS                           | —                                     |
| UI kit                 | shadcn/ui                              | Radix UI (raw)                        |
| Drag & drop            | @dnd-kit                               | pragmatic-drag-and-drop               |
| Charts                 | Recharts                               | Chart.js, Apache ECharts              |
| Auth                   | Better Auth (organization plugin)      | Auth.js / NextAuth (maintenance mode) |
| Email                  | `nodemailer` over SMTP                 | Provider API (Resend, SendGrid, …)    |
| Deployment             | Docker Compose                         | Kubernetes (once scale demands it)    |

Architecture (monorepo + modular monolith) is covered separately in [architecture.md](architecture.md).

---

## 2. Rationale by layer

### Backend — NestJS 11 + TypeScript

Both commercial reference points run this way: ClickUp on TypeScript/Node.js/NestJS/PostgreSQL, Linear fully on Node.js + TypeScript with PostgreSQL and Redis. **NestJS 11** is the pinned major (latest stable as of Phase 0; NestJS 12's ESM migration was still in draft). NestJS's module system keeps a many-module product (auth, workspace, board, task, dashboard, notification) orderly when a single developer or a small team is building it. Sharing a language with the frontend is what makes `packages/shared-types` possible, which pays off on every data model change. Most open-source alternatives (Plane, Taiga) chose Django for fast CRUD plus a free admin panel — a good trade when realtime sync is not the priority, and the wrong one here.

### Database — PostgreSQL + Redis

Uncontroversial: ClickUp, Linear, Plane, Taiga, and Focalboard all sit on Postgres. JSON columns cover flexible metadata (custom fields, activity payloads) while relational integrity covers the task/board graph. Redis then serves four needs with one tool: notification queue, session store, rate limiting, and the Socket.io pub/sub adapter.

Both versions are pinned on purpose. **PostgreSQL 18** is the current major; the previous one is supported for years yet, but a major bump after v0.1 ships costs every self-hoster a `pg_dump`/restore — the official image refuses to start against a `PGDATA` volume initialized by a different major ([development.md](development.md#upgrading-and-backups)). Doing it now, with no data in existence, is free. **Redis 8** is a licensing choice as much as a version one: the 7.4–7.8 band is RSALv2/SSPLv1 only, which is source-available and not OSI open source, and Redis 8 restored an OSI option — AGPLv3, the same licence Kurultay ships under. A self-hoster who redistributes the stack inherits no licence question they did not ask for. Valkey (BSD-3-Clause, the Linux Foundation fork of Redis 7.2.4) is protocol-compatible and remains a one-line image swap if a permissive licence is ever needed downstream.

### ORM — Prisma

Drizzle and Prisma are the two dominant TypeScript ORMs in 2026 and both are production-ready. Drizzle offers SQL-level control and the smallest footprint (~7.4kb); Prisma offers a schema-first workflow, a mature ecosystem, and tooling such as Prisma Studio — and since Prisma 7 dropped its Rust dependency, the old bundle-size objection is largely gone. Prisma wins here because its migration story is more guided, which saves debugging time when working alone. Drizzle's performance edge lives in the ORM layer, and a 5–50 ms database round trip dwarfs it in practice.

### Realtime — Socket.io + Redis adapter

For self-hosted infrastructure, Socket.io with `@socket.io/redis-adapter` is the standard answer: the adapter broadcasts events across every server instance, which is a hard requirement for horizontal scaling. Raw `ws` has lower overhead but leaves room management and reconnection logic to you — and a Kanban board needs both. Managed services (Ably, Pusher, Liveblocks) solve a serverless problem that does not apply when we run our own servers.

### Drag & drop — @dnd-kit

`react-beautiful-dnd` is deprecated — Atlassian withdrew from it. Kurultay uses the **classic `@dnd-kit` line** (`@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0, pinned): MIT, ~6 KB core, accessible (keyboard and screen reader), framework-agnostic, and the most widely deployed React drag-and-drop library. It is also **frozen** — no release since December 2024, docs-site repo archived in February 2026, maintainer effort moved to a pre-1.0 rewrite (`@dnd-kit/react`) with a different API that we are not adopting. Atlassian's `pragmatic-drag-and-drop` (Apache-2.0) is actively released and is the fallback, at the cost of hand-writing collision detection. Frozen-but-stable beats moving-and-pre-1.0 for a solo maintainer at 50–200 cards per board; the full argument and the re-evaluation trigger are in [`decisions/0003-frontend-stack.md`](decisions/0003-frontend-stack.md). The critical companion rule is ordering: positions are stored as floats and reordered by **fractional indexing**, never as renumbered integers.

### Charts — Recharts

The safest default for a React dashboard: broad ecosystem adoption, a comprehensible component API, SVG rendering, MIT licensed, and it composes well with shadcn/ui. It is not the lightest option, and the cost worth recording is the dependency surface rather than a byte count: Recharts v3 declares `@reduxjs/toolkit`, `react-redux`, `immer`, and `victory-vendor` (d3 modules) as runtime dependencies, so adopting it pulls Redux Toolkit into an app that otherwise has no state library. Revisit if the chart count grows, if a bundle budget tightens, or if that dependency graph starts conflicting with app-level state choices — a Canvas-based library (Chart.js, Apache ECharts) is the fallback.

### Auth — Better Auth

Multi-tenant workspaces are the heart of this product, so auth is a load-bearing choice. Better Auth is the strongest self-hosted option for new projects in 2026 — more capable than NextAuth, free, actively maintained — and Auth.js/NextAuth is in maintenance mode with Better Auth positioned as its successor. The decisive factor is the **organization plugin**: multi-tenant organizations, invitations, member roles, and permissions out of the box, which would take weeks to build. In product language those map 1:1 to **Workspace** / **WorkspaceMember** / invitations — see [`decisions/0004-auth-better-auth.md`](decisions/0004-auth-better-auth.md#domain-mapping-organization--workspace). Self-hosting keeps data sovereignty in-house with no dependency on a managed service like Clerk. Note that Better Auth ships backend logic only — login and register UI is ours to write.

### Email — nodemailer over SMTP

Kurultay sends one class of transactional email so far: the verification link an invitee needs before `better-auth`'s hardened invitation-acceptance check will let them join a workspace (see [`decisions/0013-invitation-email-verification.md`](decisions/0013-invitation-email-verification.md)). `nodemailer` talks plain SMTP, configured only through `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_SECURE` / `MAIL_FROM` — no provider SDK, so self-hosters point it at whatever mail server they already run instead of creating a new vendor account. `docker-compose.dev.yml` runs [Mailpit](https://mailpit.axllent.org/) as a local SMTP catch-all so development never sends real mail; see [development.md#smtp-and-mailpit](development.md#smtp-and-mailpit).

### Frontend — Next.js 16

**Next.js 16** (App Router) is the pinned major for `apps/web`. Tailwind, shadcn/ui, classic `@dnd-kit`, and Recharts sit on top; details and trade-offs are in [`decisions/0003-frontend-stack.md`](decisions/0003-frontend-stack.md).

### i18n — next-intl

`next-intl` is wired from Phase 1 — every user-facing string goes through `useTranslations()` / `messages/en.json` rather than being hardcoded — so the app is translation-ready even though the locale is currently hardcoded to `en` and there is no locale switcher yet (MVP is English-only, see [roadmap.md — Beyond MVP](roadmap.md#beyond-mvp)). The alternative was retrofitting i18n after strings had already spread through the component tree, which is the more expensive order.

### Deployment — Docker Compose

Four services — `api`, `web`, `postgres`, `redis` — matching the existing self-managed Linux server setup. The path to Kubernetes stays open for when scale demands it (both ClickUp and Linear ended up there), but Compose on a single host is the right size for now.

---

## 3. Deliberately not included

| Technology              | Why not now                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| Kafka                   | ClickUp uses it, but at 20M+ user scale. Redis pub/sub is more than enough for the MVP; it can be added later |
| GraphQL                 | Linear uses it. REST is faster to start with; revisit when API consumers diversify                            |
| Elasticsearch           | Full-text search can start with PostgreSQL's built-in FTS                                                     |
| Kubernetes              | Docker Compose on one host is sufficient. Migrate when traffic requires it                                    |
| MinIO / S3              | File attachments are out of MVP scope. When added, pick an S3-compatible store                                |
| Local-first sync engine | Linear's largest technical investment. Very high complexity — start server-first                              |

---

## 4. Open-source references

Projects worth studying for architecture and data modelling:

| Project     | Backend              | Frontend | Note                                          |
| ----------- | -------------------- | -------- | --------------------------------------------- |
| Plane       | Django               | Next.js  | The most popular OSS PM tool, AGPL-3.0        |
| Huly        | TypeScript / Node.js | Svelte   | Full TS, but carries Rush monorepo complexity |
| Taiga       | Django               | React    | Agile/Scrum focused, MPL-2.0                  |
| OpenProject | Ruby on Rails        | Angular  | Oldest / enterprise, GPL-3.0                  |
| Focalboard  | Go                   | React    | Simple Kanban, no longer actively maintained  |

---

## 5. Decision records

Full arguments and consequences live in [`decisions/`](decisions/) rather than being repeated here:

| ADR                                                                                            | Topic                                                            |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`0001-monorepo-modular-monolith.md`](decisions/0001-monorepo-modular-monolith.md)             | Monorepo + modular monolith                                      |
| [`0002-backend-stack.md`](decisions/0002-backend-stack.md)                                     | NestJS 11 + Prisma 7 + PostgreSQL 18 + Redis 8                   |
| [`0003-frontend-stack.md`](decisions/0003-frontend-stack.md)                                   | Next.js 16 + Tailwind + shadcn/ui + @dnd-kit + Recharts          |
| [`0004-auth-better-auth.md`](decisions/0004-auth-better-auth.md)                               | Better Auth with the organization plugin (→ Workspace)           |
| [`0005-realtime-socketio.md`](decisions/0005-realtime-socketio.md)                             | Socket.io + Redis adapter                                        |
| [`0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md)                         | Float positions for ordering                                     |
| [`0007-license-agpl.md`](decisions/0007-license-agpl.md)                                       | AGPL-3.0                                                         |
| [`0008-git-flow-semver.md`](decisions/0008-git-flow-semver.md)                                 | Git Flow + SemVer                                                |
| [`0009-board-column-permissions.md`](decisions/0009-board-column-permissions.md)               | Board and column role matrix (OWNER/ADMIN structure)             |
| [`0010-task-permissions.md`](decisions/0010-task-permissions.md)                               | Task role matrix (MEMBER+ content work)                          |
| [`0011-label-task-metadata-permissions.md`](decisions/0011-label-task-metadata-permissions.md) | Label and task-metadata role matrix                              |
| [`0012-comment-delete-authorship.md`](decisions/0012-comment-delete-authorship.md)             | Comment delete: authorship or OWNER/ADMIN                        |
| [`0013-invitation-email-verification.md`](decisions/0013-invitation-email-verification.md)     | SMTP mail delivery, email verification on invitation accept only |
| [`0014-dual-licensing-cla.md`](decisions/0014-dual-licensing-cla.md)                           | Dual licensing + contributor license agreement                   |
| [`0015-no-external-contributions.md`](decisions/0015-no-external-contributions.md)             | No external contributions; CLA unenacted, legal spend deferred   |

Related: [architecture.md](architecture.md) · [project-skeleton.md](project-skeleton.md)
