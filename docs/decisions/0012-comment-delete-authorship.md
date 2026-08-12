# 0012. Comment Delete Authorship

**Status:** Accepted
**Date:** 2026-08-09

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0012-comment-delete-authorship.md)

## Context

[ADR 0011](0011-label-task-metadata-permissions.md) shipped a flat rule for Phase 5: any
MEMBER+ may delete any comment on an accessible task, explicitly rejecting an author-only
check as "extra checks; defer until abuse appears." In the Wave tech-debt hardening pass
that followed MVP completion, that flat rule turned out to be the abuse case it deferred —
any workspace member could delete a comment they did not write, with no audit trail
distinguishing "author cleaned up their own note" from "member erased someone else's." The
`CommentService.remove` fix landed ahead of the ADR update; this record makes the narrower
rule the documented decision instead of leaving 0011 describing behavior the code no longer
has.

## Decision

Comment deletion requires **authorship or an elevated role**, not bare workspace membership:

| Action           | OWNER | ADMIN | MEMBER (author) | MEMBER (not author) | GUEST |
| ---------------- | :---: | :---: | :-------------: | :-----------------: | :---: |
| Delete a comment |   ✓   |   ✓   |        ✓        |          —          |   —   |

`CommentService.remove` checks `comment.userId === actorId` OR
`actorRole ∈ {OWNER, ADMIN}`; anything else raises `ForbiddenException`. This supersedes the
"Create comments; delete any comment on an accessible task" row of
[ADR 0011](0011-label-task-metadata-permissions.md) — every other row in that ADR (label
CRUD, assignees, task metadata) is unchanged.

## Rationale

- Deleting someone else's words is a different action from deleting your own; the flat rule
  conflated them under one MEMBER+ gate meant for content work (labels, assignees, dates).
- OWNER/ADMIN keep a moderation backstop for abusive or off-topic comments — the point of
  0011's flat rule was avoiding a class of user with zero recourse, not avoiding authorship
  checks entirely.
- The check is one extra comparison already available on the loaded row (`comment.userId`)
  and the guard-resolved `actorRole` — the "extra checks" cost 0011 worried about did not
  materialize.

## Consequences

- `CommentController` passes the caller's `MemberRole` (via
  `@CurrentMembership()`) into `CommentService.remove` instead of relying on `@Roles` alone.
- Web still shows the delete affordance to every `canMutate` (MEMBER+) role regardless of
  authorship; a MEMBER deleting someone else's comment now gets a `403` toast instead of the
  request succeeding. Hiding the button for non-authors is a follow-up, not required by this
  ADR.
- `docs/api-conventions.md` and `docs/decisions/0011-label-task-metadata-permissions.md`
  cross-reference this ADR for the comment-delete rule specifically.

## Alternatives considered

| Alternative                                    | Why not                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| Keep 0011's flat "any MEMBER+ may delete"      | The abuse case 0011 deferred — no author-only recourse                  |
| OWNER/ADMIN-only delete (no author self-serve) | Members could not retract their own mistaken or duplicate comments      |
| Soft-delete with "deleted by" audit trail      | Reasonable follow-up, but a bigger schema change than this fix warrants |
