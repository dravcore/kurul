# 0031. API Versioning: a `/v1` URI Prefix Introduced at 1.0, and the Order Things Ship In

**Status:** Accepted
**Date:** 2026-08-23

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0031-api-versioning.md)

## Context

The REST API is described by a generated OpenAPI document, committed at
`apps/api/openapi.json` and served at `/docs`, with a CI gate that fails when the code and the
document disagree ([api-conventions.md](../api-conventions.md#the-openapi-document)). That is
the precondition for promising anything about compatibility: a contract has to be written down
before anyone can say it will not change.

[api-conventions.md](../api-conventions.md#versioning) has stated the position since before
this record existed: no `/v1` prefix before 1.0, breaking changes may ship in any `0.y.0`
release and are documented in `CHANGELOG.md`, and `@kurul/shared-types` is versioned with the
monorepo so a client that pins the package pins the contract. What it left open was the scheme
itself ("URI prefix is the likely choice, decided when it is actually needed") and the
alternatives, which were never rejected in writing. `ROADMAP.md`'s "API 1.0" section scoped the
three things 1.0 is expected to grow (a `/v1` prefix, personal access tokens, minimal
webhooks) and asked for exactly this: an ADR that rejects the other schemes rather than skipping
them, and that records the order the three ship in.

Three schemes were on the table.

1. **A URI prefix.** `/v1/workspaces/...`. The version is in the path, visible in every log line
   and every `curl`, and a second version is a second router mount.
2. **Header negotiation.** One path, with the version in `Accept` (`application/vnd.kurul.v1+json`)
   or a custom `X-Api-Version` header, and a default when the header is absent.
3. **No versioning.** Freeze the contract at 1.0 and evolve it additively forever; a change that
   cannot be additive is a 2.0 of the whole product.

## Decision

**A `/v1` URI prefix on every route, introduced at 1.0 and not before.** `/auth/*` and the two
health probes are outside it: Better Auth owns the first ([ADR 0004](0004-auth-better-auth.md)),
and a probe that moved with the API version would break every healthcheck on the day of the
release. Until 1.0 nothing changes: routes stay unprefixed, the pre-1.0 rules in
api-conventions.md stay in force, and a version segment that appeared now would be a promise the
project is not yet making, during the period the API is most expected to churn.

**Header negotiation and no-versioning are rejected**, for the reasons below, and the rejection
is the part of this record that matters: the prefix itself is a common choice, and the reason to
write it down is so that nobody reopens the alternatives in a PR comment.

**Sequencing: personal access tokens, then `/v1`, then webhooks.** Tokens ship first, against
the unprefixed routes. The prefix lands at 1.0, once there is a non-browser caller for whom a
stable path is worth something. Webhooks come last, because signed delivery and a failure
policy deserve their own ADR and a contract to point at. Each step is a row in `ROADMAP.md`,
and the order is a dependency, not a date.

## Rationale

**Why a prefix over header negotiation.** A self-hosted instance is called by scripts, CI jobs
and whatever an operator wires together, and those callers are the whole reason an API
version exists. A path version is visible in the access log, in a reverse proxy's routing
rules, in a bookmark and in a bug report; a header version is invisible in all four, and the
first time two callers disagree about which version they are speaking the operator has
nothing to grep. Negotiation also needs a default for a caller that sends no header, and
whichever default is chosen is wrong for one of the two populations: default to the newest and
every unpinned script breaks on upgrade, default to the oldest and every new caller gets the
legacy shape until they learn the magic header. The path has no default to get wrong. Finally,
this API is served by a Nest router behind Caddy and documented by a generated OpenAPI file:
a prefix is a mount point and a `servers` entry, while a header scheme is a content-negotiation
layer the framework does not provide and the OpenAPI document cannot express as one contract.

**Why a prefix over no versioning.** "Additive forever" is a promise about the future shape of
every response, and this project has already broken shapes it once shipped, for good reasons
(the member roster became a cursor page, the invitation response gained a delivery status). An
API that cannot ever rename a field or tighten a type is one whose mistakes become permanent
the day it is declared stable. No-versioning also makes the product's major version the API's
major version: a 2.0 of the web app would have to mean a 2.0 of every route, and a breaking
route change would have to wait for one. The two should be allowed to move separately.

**Why at 1.0 and not now.** The argument for a prefix is that it is cheap; the argument against
adding it today is that it is not free. It is a line in every client, every document, every
`curl` in every README, and the `v1` in it would be a lie: the routes behind it may still
change in any `0.y.0`. A prefix that has to be bumped during the pre-1.0 churn teaches callers
to ignore it, and a prefix that is pinned at `v1` while the contract moves teaches them
something worse. SemVer already says what 0.y means; the prefix is the 1.0 signal and should
arrive with it.

**Why tokens before the prefix.** Until there is a caller that is not the web app, the prefix
protects nobody. Personal access tokens are the first such caller, and they work against today's
unprefixed routes because the version is not what makes a token valid; so the dependency runs
tokens then prefix, never the other way round. Webhooks are last for the opposite reason: they
are the API calling out, the delivery format is itself a contract, and that contract should be
written against `/v1`'s shapes rather than re-broken by it.

## Consequences

- At 1.0, every Nest route gains the `/v1` prefix via a global path prefix, the OpenAPI
  `servers` entry changes from `/` to `/v1`, and the web app's API client follows. `/auth/*`,
  `/health` and `/health/ready` stay where they are.
- A `/v2` is a second mount of the routes that changed, beside `/v1`, for a deprecation window
  announced in `CHANGELOG.md`. The window's length is decided when the first `/v2` is needed;
  this record commits to there being one, not to how long it is.
- The pre-1.0 section of [api-conventions.md](../api-conventions.md#versioning) stays in force
  until the release that adds the prefix, and that release's changelog entry is the migration
  note.
- Personal access tokens ship against unprefixed routes and keep working after the prefix
  lands: the token identifies a user and a workspace, and neither moves.
- The ROADMAP's "API 1.0" section keeps the scope and links here for the order; this record is
  the reason, that section is the status.

## Alternatives considered

| Alternative                                    | Rejected because                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header negotiation (`Accept` or custom header) | Invisible in logs, proxies and bug reports; needs a default that is wrong for one population; not a single contract the generated OpenAPI document can express                        |
| No versioning, additive changes only           | Makes every shipped shape permanent; couples the API's major version to the product's; this project has already needed non-additive changes before 1.0                                |
| Add `/v1` now, bump it freely before 1.0       | A version that moves during churn is one callers learn to ignore; a pinned `v1` over a moving contract is a false promise                                                             |
| Version per resource (`/workspaces/v2/...`)    | Every client holds a table of versions instead of one; the OpenAPI document becomes several; the operational visibility argument for a prefix is lost in the noise                    |
| Date-based versions (`/2026-08-23/...`)        | Honest about churn, but every date is a breaking release and callers pin a calendar instead of a contract; SemVer already exists for this and the rest of the project uses it         |
| Webhooks before tokens                         | Delivery is a contract of its own and would be written against pre-`/v1` shapes; tokens are the caller the prefix exists for, so they establish the need before the prefix answers it |
