# 0004. Auth: Better Auth with Organization Plugin

**Status:** Accepted
**Date:** 2026-08-08

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
