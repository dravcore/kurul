# 0030. TypeScript Stays on the 5.x Line Until typescript-eslint and ts-jest Support 7

**Status:** Accepted

**Date:** 2026-08-23

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0030-typescript-7-hold.md)

## Context

TypeScript 7.0 (the Go-rewritten, ~10x-faster compiler previously known as `tsgo`) reached
general availability on 2026-08-20 as `typescript@7.0.2`. `typescript` is pinned `^5.8.2` in
this repository's four `package.json` files (root, `apps/api`, `apps/web`,
`packages/auth-access`, `packages/shared-types`) and resolves to `5.9.3` in the lockfile.
`.github/dependabot.yml` already carries an `ignore` rule refusing major-version bumps of
`typescript`, with a comment naming two peer-range ceilings as the reason. That comment was
written before TypeScript 7.0 shipped, on the strength of the published peer ranges alone; this
ADR checks it against what actually happened at release, cites the maintainers directly, and
gives the hold a trigger a future PR can check without re-deriving any of this.

**What blocks 7, verified against what is installed today, not guessed:**

- **`typescript-eslint`** (`@typescript-eslint/typescript-estree`, the package actually holding
  the peer range) declares `"typescript": ">=4.8.4 <6.1.0"` as of `8.67.0`, the version this
  repo runs. Two compatibility reports —
  [typescript-eslint#12720](https://github.com/typescript-eslint/typescript-eslint/issues/12720)
  and [#12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518) — were both
  closed `NOT_PLANNED` on the day of TypeScript 7's release. Maintainer bradzacher, on the
  project's pinned tracking issue
  [#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940): "For now -
  there is nothing we can do to support tsgo / TSv7. As mentioned in the blog post and
  highlighted above - there is currently no stable JS API." That issue is now locked, waiting on
  the API.
- **`ts-jest`** declares `"typescript": ">=4.3 <7"` as of `29.4.12`, the version this repo runs.
  [kulshekhar/ts-jest#5366](https://github.com/kulshekhar/ts-jest/issues/5366) is open;
  maintainer kulshekhar, reopening it after a too-broad first close: "TypeScript 7 currently
  lacks the JavaScript compiler API ts-jest relies on, so proper direct support requires a
  different integration and not merely widening the peer range... We'll essentially need to wait
  for 7.1 (assuming the stable programmatic api will land in 7.1)."
- **The TypeScript team says the same thing about their own release.** From the
  ["Announcing TypeScript 7.0"](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  devblog: "While TypeScript 7.0 is here, it does not ship with an API. We expect TypeScript 7.1
  to ship with a new (and different) API, but until then we have made it a priority to ensure
  TypeScript can be run side-by-side with TypeScript 6.0 for utilities that still need some
  programmatic access to the compiler (such as typescript-eslint)." They ship a
  `@typescript/typescript6` compatibility package (a `tsc6` binary plus a re-export of the 6.0
  API) for exactly this transition period. No release date for 7.1 is given; the same post
  estimates "a fairly similar timeline to releases prior to TypeScript 7.0, with new featureful
  versions published every 3-4 months" from the 2026-08-20 GA, i.e. some time around
  late 2026.

**What does not block 7, checked the same way and worth recording so nobody re-litigates it:**

- **Prisma.** The `prisma` package's `peerDependencies.typescript` is `">=5.4.0"` — open-ended,
  already satisfied by 7. Nothing in the generator or CLI gates on a TypeScript major version.
- **`@nestjs/cli`.** No `typescript` `peerDependency` at all. It ships its own `typescript`
  (pinned `5.9.3`) as a plain `dependency`, used internally for `nest build`'s default
  tsc-based compilation — so it is not gated by the workspace's installed TypeScript version at
  install time. (Whether `nest build` type-checks cleanly against a 7.x tsconfig is untested
  here since 7 cannot be installed anyway with the two blockers above still holding it back.)
- **Next.js 16 (`16.3.0`).** No `typescript` `peerDependency`. Type-checking during `next build`
  is optional and reads whatever `typescript` the project resolves; it is not a version gate.
- **Vitest (`4.1.10`).** No `typescript` `peerDependency` — its peers are `vite`, `jsdom`,
  `happy-dom`, `@types/node` and its own plugin packages. `apps/web`'s test runner has no
  TypeScript-version dependency on this axis at all.

So the hold is narrower than "the TypeScript ecosystem isn't ready": exactly two packages gate
it, both for the identical reason (no stable TypeScript 7 compiler API to run against, by both
their own and Microsoft's account), and both maintainers point at the same unblock.

## Decision

**`typescript` stays `^5.8.2` in all four `package.json` files, and the `dependabot.yml` ignore
rule for `typescript`'s major-version updates stays, until both of the following are true:**

1. `typescript-eslint` (checked via `@typescript-eslint/typescript-estree`'s published
   `peerDependencies.typescript`) accepts a `7.x` version in a stable, non-prerelease release.
2. `ts-jest`'s published `peerDependencies.typescript` accepts a `7.x` version in a stable,
   non-prerelease release.

**Trigger, checked either when Dependabot next proposes a `typescript` major bump (it cannot
today — the ignore rule filters it out — so this means checking by hand) or by
2026-12-01, whichever comes first:** read the two peer ranges above off npm
(`npm view typescript-eslint peerDependencies`, `npm view ts-jest peerDependencies`) or their
`CHANGELOG.md`s. If both include `7`, open a PR that in one change: bumps `typescript` to `^7.x`
in all four `package.json` files, removes the `dependabot.yml` ignore rule (and this ADR's
comment reference, superseding it with a one-line note), and runs `pnpm lint`, `pnpm test`,
`pnpm typecheck`, `nest build` and `next build` once against 7 before merging — those last two
are not proven clean today because 7 cannot be installed alongside the two blockers, so the
first real bump is also the first real test of them. If only one condition holds, log the date
checked and which package is still blocking in this ADR's changelog and defer three more months
rather than re-deriving the whole picture.

The `.github/dependabot.yml` `ignore` comment is updated in this PR to point at this ADR instead
of restating the rationale inline.

## Rationale

**Why an upper-bound peer range is treated as a hard blocker rather than something to override.**
`pnpm install` refuses a `typescript@7` install against `typescript-eslint@8.67.0`'s
`<6.1.0` ceiling outright (`ERESOLVE`/`peer dep` failure), and forcing it past that with
overrides does not change what actually breaks: `ts-jest`'s own compatibility page (referenced
from its reopened issue) documents that TypeScript 7 "does not expose the JavaScript compiler
API required by ts-jest" — the transform crashes at runtime, not at install time, so an
override would trade a loud failure for a silent one. Neither tool is behind on packaging; both
maintainers have said in public, on the record, that the API they depend on does not exist yet
in 7.0. There is nothing this repository can do that unblocks either one sooner.

**Why the trigger is "both peer ranges accept 7" rather than "TypeScript 7.1 ships."** 7.1
shipping the promised API is necessary but not sufficient — both maintainers still have to cut a
release against it, and `ts-jest`'s history above (`29.4.12` was published claiming Issue
resolution and reopened days later once users reported the peer range was unchanged) shows that
"a release referencing TypeScript 7" and "a release whose peer range actually accepts 7" are not
the same event. Checking the published range is the only signal that cannot be half-true.

**Why this is a repo-wide pin and not per-package.** All four `package.json` files already carry
the same `^5.8.2`, and the two blocking peers sit in `apps/api` (`ts-jest`) and at the workspace
root (`typescript-eslint`, shared by both apps' lint configs). A split version would need every
consuming package to resolve its own `typescript`, which `pnpm`'s workspace hoisting does not
give for a peer dependency shared this widely, and would turn one blocked upgrade into a matrix
of "which typescript does this file see" bugs for a compiler speed win nobody is blocked on
today.

## Consequences

- `pnpm install`, `pnpm lint` and `pnpm test` (via `ts-jest` in `apps/api`) keep working exactly
  as they do today; nothing about this ADR changes current behaviour, only what stops the next
  routine dependency bump.
- `.github/dependabot.yml`'s `ignore` rule for `typescript` major updates now cites this ADR by
  path in its comment instead of restating the two peer ranges inline, so the two documents
  cannot drift out of sync silently — a change to either range is a reason to reread both.
- The eventual bump is deliberately bundled with a `nest build` / `next build` check, because
  those two are the pieces of this toolchain nobody has been able to test against 7 yet (no
  formal peer gate blocks the _install_, but that also means nobody has proven the _build_
  clean) — see the "does not block" list above.
- No code in this repository is written today anticipating TypeScript 7 syntax or API changes;
  there is nothing to migrate ahead of time, only the version pin and the two upstream releases
  to wait for.

## Alternatives considered

| Alternative                                                                                       | Why not                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Force the bump with pnpm overrides, ignore the peer warning                                       | The warning is not the real failure — `ts-jest` crashes at transform time because the TS7 binary does not expose the compiler API it calls, so this trades a loud `pnpm install` failure for tests failing in CI instead |
| Alias TypeScript 6 and 7 side by side (`@typescript/typescript6` for lint/test, real 7 for build) | Doubles the installed compiler, needs per-tool aliasing nobody else on the team would expect, and buys a compile-speed win the repo is not currently blocked on — not worth the complexity before 7.1 ships anyway       |
| Replace `ts-jest` with `@swc/jest` now to remove one blocker early                                | A transform-engine swap unrelated to the TS7 question, changes what `pnpm test` actually type-checks (`@swc/jest` does not type-check), and still leaves `typescript-eslint` as a hard blocker on its own                |
| No ADR; keep the dependabot comment as the only record                                            | The Hardening roadmap item asked for a citable decision the ignore rule can point to; a comment alone has no room for the maintainers' own statements or a trigger a future PR can check without re-researching this     |
| Trigger on "TypeScript 7.1 released" instead of the peer ranges                                   | Necessary but not sufficient — `ts-jest`'s own history here shows a release can reference TS7 support without the peer range actually widening; the range is the only claim that can't be half-true                      |
