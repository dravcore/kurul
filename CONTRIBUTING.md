# Contributing to Kurultay

How to propose, build, and submit changes.

Kurultay is AGPL-3.0 — see [LICENSE](LICENSE). Outside code, documentation, and translation
pull requests are **not accepted**; the reasoning is immediately below. Everything else —
bug reports, feature ideas, design feedback — is wanted as much as ever.

## Code contributions are paused

> **We do not merge outside code, documentation, or translation pull requests.** This has no
> end date. Ideas, bug reports and discussion are wanted as much as ever — see
> [Ways to contribute](#ways-to-contribute).
>
> One exception: a typo or a dead link is still welcome as a one-line PR. A corrected spelling
> is not an original work, so there is nothing to license and nothing to unpick later.

Kurultay is meant to fund itself by **dual licensing** — the same AGPL-3.0 codebase, also sold
to organizations under a commercial license — and that only works if one person holds the right
to license every line. A merged outside patch would sit in the codebase with its copyright
unresolved unless its author had signed a
[Contributor License Agreement](docs/cla.md) first. That agreement exists as a draft, but it is
not in force and it is not being enacted: making it binding needs a lawyer's review that the
maintainer is not commissioning for now. Collecting signatures against an unreviewed document
would be worse than collecting none, because an invalid signature only reveals itself years
later, at the most expensive possible moment.

So the honest thing is to say no up front rather than accept a patch that could not be used.
The pause is **indefinite**: the draft is kept ready and would be activated if legal review
ever happens, but no such review is planned, and no date is being promised.
[SQLite](https://www.sqlite.org/copyright.html) has run this way for decades for much the same
reason. This is a choice, not a hardship — single authorship keeps every option open, and the
full reasoning, including what it costs, is in
[ADR 0015](docs/decisions/0015-no-external-contributions.md).

**Please do not paste code into issues or comments.** Describe the change, point at the file
and line, explain the approach — all of that is welcome and useful. But a diff or a snippet is
your copyrighted work, and if it is sitting in the thread the maintainer cannot safely read it
and then write the fix. Keeping code out of the discussion keeps that path clear.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Read it before
opening an issue or PR.

## Contributor License Agreement

> **Not in force, and nobody is being asked to sign anything.** [docs/cla.md](docs/cla.md) is
> an unreviewed draft, the `CLA` workflow is
> [disabled](.github/workflows/cla.yml) — no bot will comment on your pull request — and no
> legal review is scheduled ([ADR 0015](docs/decisions/0015-no-external-contributions.md)).
> Since outside code is not merged at all, there is nothing to sign and no signature would be
> collected even if you offered one. **This section describes how the agreement would work if
> it were ever activated. None of it is happening today.**

**Why it exists.** Kurultay is AGPL-3.0 and stays that way — one codebase, nothing withheld
from the community. The project is meant to fund itself through **dual licensing**: the
maintainer also sells organizations a commercial license to the same code, exempting them from
AGPL's obligations. Selling that exemption requires the right to distribute _all_ of the code
under a license other than AGPL-3.0, including the parts you wrote. By default you own the
copyright in your patch and nobody may relicense it, so the CLA is where you grant that
permission explicitly.

Put plainly, without hedging: **you are granting the maintainer the right to also sell your
contribution under a commercial license.** In return, the agreement guarantees your
contribution keeps being published under AGPL-3.0, and you keep the copyright and every right
to reuse, relicense, or republish your own code exactly as if you had never signed. The full
reasoning, including the parts that are a cost to you, is in
[ADR 0014](docs/decisions/0014-dual-licensing-cla.md).

**How signing would work.** Inside the pull request — no email, no PDF. A bot would comment with
a link to [docs/cla.md](docs/cla.md); you would read it and post a new comment containing
exactly the sentence it quotes, turning the **CLA** check green and covering every future PR
from the same GitHub account. That workflow is written and pinned in
[`.github/workflows/cla.yml`](.github/workflows/cla.yml), but it is switched off, so today it
comments on nothing and no check appears on your PR.

**Nothing depends on signing today.** Issues, reviews, and discussion are unaffected, and a
well-reported bug is valuable with no code attached. If you have a fix in mind, say so on the
issue — describe it rather than attaching a patch, and the maintainer can write it
independently.

**Contributing for an employer.** If the agreement were ever activated and you were
contributing as part of your job, your employer may own the copyright and you would need their
approval before signing. There is no Entity CLA, so a company has no path here at all. See
[docs/cla.md](docs/cla.md#corporate-and-entity-contributions).

## Ways to contribute

| Type             | Status | How                                                                        |
| ---------------- | ------ | -------------------------------------------------------------------------- |
| Bug report       | Open   | [Open a bug report issue](.github/ISSUE_TEMPLATE/bug_report.yml)           |
| Feature idea     | Open   | [Open a feature request issue](.github/ISSUE_TEMPLATE/feature_request.yml) |
| Design feedback  | Open   | Comment on an issue, or open a discussion                                  |
| Typo / dead link | Open   | A one-line PR is fine                                                      |
| Code             | Paused | See [Code contributions are paused](#code-contributions-are-paused)        |
| Docs             | Paused | Same reason — a written page is a copyrighted work                         |
| Translation      | Paused | Same reason — a translation is a derivative work                           |

A feature idea, a bug report, or "this flow feels wrong and here is why" carries no copyright:
they are facts and ideas, and they are genuinely the most useful thing anyone can send right
now. What carries copyright is the written expression — a patch, a page of prose, a
translation — and that is what the pause is about.

## Issue-first rule

Propose before you implement. Open or find an issue and get it acknowledged before
starting non-trivial work — this avoids duplicate effort and wasted review time on changes
that won't be accepted. Trivial fixes (typos, broken links) can skip straight to a PR.

## Development setup

Clone, install, and run the monorepo (`apps/api`, `apps/web`, Postgres, Redis) using
[docs/development.md](docs/development.md) — start there for environment variables,
Compose, migrations, and the day-to-day loop. Quick start is also in the root
[README.md](README.md).

## Branching and commits

- Branch off `develop`, named `<type>/<short-description>` (e.g. `feature/board-dnd`,
  `fix/task-position-rounding`)
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, ...), in English

Full branch model (Git Flow: `main` / `develop` / `feature/*` / `fix/*` / `docs/*` /
`chore/*` / `release/*` / `hotfix/*`) and commit conventions:
[docs/git-strategy.md](docs/git-strategy.md).

## Coding guidelines

Conventions for TypeScript/NestJS/Next.js code: [docs/coding-standards.md](docs/coding-standards.md).
Test expectations: [docs/testing.md](docs/testing.md).

## Making a pull request

- **Target `develop`** (except `release/*` / `hotfix/*`, which follow
  [docs/git-strategy.md](docs/git-strategy.md)).
- **Keep PRs small and focused.** Aim for under 500 lines changed and a single
  responsibility per PR (excluding docs/lockfiles). Split schema changes from logic
  changes, and frontend from backend, where possible.
- Link the issue the PR addresses.
- Fill in the PR template checklist (conventional title, docs updated where relevant,
  lint/typecheck/tests once CI exists).
- Expect **one approving review** before merge; maintainers merge into `develop` with a merge
  commit (`--no-ff`) — nothing is squashed, so keep the branch's own commit history readable.
  While Kurultay has a single maintainer there is nobody to review _their_ PRs, so
  maintainer-authored PRs are self-reviewed and self-merged once CI is green. Your PRs are
  reviewed as normal, and the review requirement applies to everyone again as soon as a
  second maintainer exists.
- Clean up noisy fixup commits (interactive rebase or amend) before requesting review — they
  land in `develop` as-is.

## Need help?

Open a [GitHub Discussion](https://github.com/dravcore/kurultay/discussions) or comment on
the relevant issue.
