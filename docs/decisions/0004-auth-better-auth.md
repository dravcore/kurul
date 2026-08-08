# 0004. Auth: Better Auth with Organization Plugin

**Status:** Accepted
**Date:** 2026-08-08
**Updated:** 2026-08-08 — adds the integration risk of the community-maintained NestJS path and Better Auth's pre-2.0 release cadence.

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0004-auth-better-auth.md)

## Context

Multi-tenant workspaces are core to the product — every user belongs to one or
more workspaces with roles and invites — so the auth choice determines how much
multi-tenancy logic has to be hand-built versus reused.

## Decision

**Better Auth**, using its **organization plugin**, over Auth.js/NextAuth and
over Clerk.

## Rationale

- Better Auth is the strongest self-hosted option for new 2026 projects: more
  features than NextAuth, free, actively maintained.
- The **organization plugin** covers multi-tenant organization management,
  invites, and member roles/permissions out of the box — building that from
  scratch would take weeks and touch nearly every module.
- Auth.js (NextAuth) is in maintenance mode; Better Auth is positioned as its
  practical successor.
- Self-hosted keeps data sovereignty with us, with no dependency on a managed
  service like Clerk — consistent with the project's self-hosted, AGPL
  positioning (see [0007](0007-license-agpl.md)).

**Note:** Better Auth provides backend logic only, not UI. Login, register, and
invite-acceptance screens are ours to design and build.

## Domain mapping: organization → Workspace

Better Auth's organization plugin speaks *organization*, *member*, and
*invitation*. Kurultay's product language and REST API use **Workspace**,
**WorkspaceMember**, and workspace-scoped invitation routes
(`POST /workspaces/:workspaceId/invitations`, …). Treat the mapping as 1:1:

| Better Auth (plugin) | Kurultay (product / API) |
|---|---|
| Organization | Workspace |
| Member | WorkspaceMember |
| Invitation | Invitation (no separate Prisma model in Phase 1) |

Invite persistence lives in Better Auth's organization tables. Phase 1 does
**not** add a Kurultay `Invitation` model; Phase 2 wires the Nest `workspace`
module to the plugin and decides whether our `Workspace` / `WorkspaceMember`
rows are the same tables (via Prisma models aligned to Better Auth) or a thin
sync layer on top. Either way, public API responses never expose the word
"organization".

## Integration risk

The library choice is well-supported; the *pairing* is the least-travelled path
Better Auth offers, and that is worth budgeting for rather than discovering.

- **The NestJS integration is community-maintained**, not first-party.
  Better Auth's own first-class targets are Next.js, Hono, and Elysia; NestJS
  is served by a third-party module, `@thallesp/nestjs-better-auth`. Its
  requirements leak outward: it needs NestJS's **application-level bodyParser
  disabled** for the auth routes, which is a global change affecting how every
  controller receives its body. If that friction bites, the escape hatch is to
  mount Better Auth's framework-agnostic Node handler directly on the Express
  instance and skip the wrapper module entirely.
- **Better Auth ships breaking changes inside 1.x.** It is pre-2.0 and minors
  move fast. The organization plugin has already restructured its teams
  schema once — `member.teamId` was removed in favour of a `teamMembers`
  table, a migration for existing adopters. Our `workspaceId` isolation model
  ([architecture.md §7](../architecture.md#7-multi-tenant-isolation)) sits on
  top of these tables, so that churn is not contained inside the auth module.
- **Therefore: pin the minor version** in `package.json` (no `^`), read the
  release notes before every bump, and treat an auth upgrade as migration work
  rather than routine dependency maintenance.

## Consequences

- Weeks of custom org/invite/role logic avoided.
- Auth data and sessions stay on our own infrastructure.
- Active maintenance reduces the risk of picking an abandoned dependency.
- Being a newer project than NextAuth means a smaller community and fewer
  battle-tested examples to lean on when something goes wrong.
- We own the full UI/UX surface for every auth flow — Better Auth gives no
  visual scaffolding to start from.
- Should we ever need to migrate away, both the backend integration and the
  custom UI built around it would need to move together.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Auth.js / NextAuth | In maintenance mode, reduced feature velocity |
| Clerk | Managed service — fast to integrate but cedes data sovereignty and adds recurring cost, at odds with a self-hosted AGPL product |
