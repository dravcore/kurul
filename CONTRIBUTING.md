# Contributing to Kurultay

How to propose, build, and submit changes.

Kurultay is AGPL-3.0. By contributing, you agree your contributions are licensed under the
same terms — see [LICENSE](LICENSE).

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Read it before
opening an issue or PR.

## Ways to contribute

| Type | How |
|---|---|
| Bug report | [Open a bug report issue](.github/ISSUE_TEMPLATE/bug_report.yml) |
| Feature idea | [Open a feature request issue](.github/ISSUE_TEMPLATE/feature_request.yml) |
| Code | Claim an approved issue, then open a PR (see below) |
| Docs | PRs against `docs/` follow the same process as code |
| Translation | Turkish docs live under `docs/tr/`; README's Turkish sibling is `README.tr.md` |

## Issue-first rule

Propose before you implement. Open or find an issue and get it acknowledged before
starting non-trivial work — this avoids duplicate effort and wasted review time on changes
that won't be accepted. Trivial fixes (typos, broken links) can skip straight to a PR.

## Development setup

Kurultay is pre-skeleton: `apps/api` and `apps/web` don't exist yet. The environment,
commands, and daily workflow contract for when the skeleton lands is already documented in
[docs/development.md](docs/development.md) — start there.

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
- Expect **one approving review** before merge; maintainers squash-merge into `develop`.
  While Kurultay has a single maintainer there is nobody to review *their* PRs, so
  maintainer-authored PRs are self-reviewed and self-merged once CI is green. Your PRs are
  reviewed as normal, and the review requirement applies to everyone again as soon as a
  second maintainer exists.
- Keep commit history readable; squash noisy fixup commits before requesting review.

## Need help?

Open a [GitHub Discussion](https://github.com/dravcore/kurultay/discussions) or comment on
the relevant issue.
