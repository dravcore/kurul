# Contributing to Kurultay

How to propose, build, and submit changes.

Kurultay is AGPL-3.0. By contributing, you agree your contributions are licensed under the
same terms — see [LICENSE](LICENSE) — and you sign a
[Contributor License Agreement](docs/cla.md) that additionally lets the maintainer license
your contribution commercially. That is explained in full below.

## Code contributions are paused

> **We are not merging outside code, documentation, or translation pull requests right now.**
> Ideas, bug reports and discussion are wanted as much as ever — see
> [Ways to contribute](#ways-to-contribute).
>
> One exception: a typo or a dead link is still welcome as a one-line PR. A corrected spelling
> is not an original work, so there is nothing to license and nothing to unpick later.

The Contributor License Agreement below is a draft awaiting legal review. Until it is in
force, a merged patch would sit in the codebase with its copyright unresolved: the maintainer
could not license it commercially, and undoing that later means finding the author or deleting
and rewriting their work. Neither is fair to you.

So the honest thing is to say no up front rather than accept a patch we cannot use. This is
temporary — the pause lifts when the CLA does. [SQLite](https://www.sqlite.org/copyright.html)
runs this way permanently for the same reason; we do not intend to.

**Please do not paste code into issues or comments.** Describe the change, point at the file
and line, explain the approach — all of that is welcome and useful. But a diff or a snippet is
your copyrighted work, and if it is sitting in the thread the maintainer cannot safely read it
and then write the fix. Keeping code out of the discussion keeps that path clear.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Read it before
opening an issue or PR.

## Contributor License Agreement

> **Not in force yet.** [docs/cla.md](docs/cla.md) is a draft awaiting legal review, and the
> CLA check is scaffolding until that review lands. Nobody is being asked to sign anything
> today. This section describes how it will work.

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

**How to sign.** Inside the pull request — no email, no PDF. When you open a PR, a bot comments
with a link to [docs/cla.md](docs/cla.md). Read it, then post a new comment containing exactly
the sentence the bot quotes. The **CLA** check turns green, and you are covered for every
future PR from the same GitHub account. Comment `recheck` if a check goes stale. Maintainers
are allowlisted and are not prompted on their own PRs.

**If you do not sign.** The **CLA** check stays red and the PR cannot be merged. Nothing else
happens: issues, reviews, and discussion are unaffected, and a well-reported bug is valuable
with no code attached. If you would rather not sign, say so on the issue — a maintainer can
often write the fix independently.

**Contributing for an employer.** If you are contributing as part of your job, your employer
may own the copyright, and you need their approval before signing. There is no Entity CLA yet —
flag it on the PR so a maintainer can handle it rather than discover it later. See
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
