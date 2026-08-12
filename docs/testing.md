# Testing

What Kurultay tests, with which tools, and what CI enforces.

> 🌐 English (canonical) | [Türkçe](tr/testing.md)

## Contents

- [Strategy](#strategy)
- [The pyramid](#the-pyramid)
- [What must be tested](#what-must-be-tested)
- [File conventions](#file-conventions)
- [Running tests](#running-tests)
- [Writing tests](#writing-tests)
- [Coverage](#coverage)
- [CI](#ci)

## Strategy

Kurultay’s MVP feature set is complete; the testing strategy stays deliberately
**pragmatic, not exhaustive**:

- Test the logic that is **hard to get right** and **expensive to get wrong** — ordering,
  tenant isolation, auth.
- Test the API **against a real PostgreSQL**, not a mocked Prisma client. Most bugs worth
  catching at this stage live in the query, not in the TypeScript.
- Do **not** chase a coverage number. Do not write tests that only restate the
  implementation.
- Browser e2e is deferred until the UI stops changing shape weekly.

The cost of a test is not writing it — it is maintaining it through every refactor. Tests
are written where that cost buys real confidence.

## The pyramid

| Layer           | Tool                                   | Scope                                                                                     | Status                                                    |
| --------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Unit**        | Jest (`apps/api`), Vitest (`apps/web`) | Services, guards, pure functions, board/permission logic, DnD hooks. Dependencies mocked. | Required from day one                                     |
| **Integration** | Jest + Supertest                       | HTTP request → controller → service → **real Postgres** (via `docker-compose.dev.yml`)    | Required for every endpoint                               |
| **E2E**         | Playwright                             | Browser flows across the full stack                                                       | **Not set up in MVP** — reserved for critical flows later |

```
        /\        e2e — deferred (Playwright)
       /  \
      /────\      integration — every endpoint (Supertest + real Postgres)
     /      \
    /────────\    unit — services, guards, pure logic (Jest), web logic/hooks (Vitest)
```

Full component-tree rendering tests are not part of the MVP. Web unit tests cover pure logic
(`lib/*.test.ts` — permissions, position math, mentions, query params) and the board
drag-and-drop hook in isolation; type safety plus integration coverage of the API is the
trade-off for everything else, and when the board UI stabilizes, Playwright covers it end to
end rather than more component tests covering it in pieces.

## What must be tested

These three areas are non-negotiable. A PR touching them without tests does not merge.

### 1. Fractional indexing (`Task.position`)

`Task.position` is a `Float` and the entire drag-and-drop ordering model depends on it. Cases
that must be covered:

| Case                               | Expectation                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| Insert between two cards           | New position is strictly between the neighbours                                       |
| Insert at the top of a column      | Position is less than the current first                                               |
| Insert at the bottom               | Position is greater than the current last                                             |
| Insert into an empty column        | A valid starting position is produced                                                 |
| Move within the same column        | Only the moved row is updated                                                         |
| Move across columns                | `columnId` and `position` both update; no other row changes                           |
| Repeated inserts in the same gap   | Float precision is not exhausted; if the gap becomes too small, the column rebalances |
| Concurrent moves into the same gap | No two tasks end up with the same position, or the tie is resolved deterministically  |

The precision-exhaustion and concurrency cases are the ones that actually break in
production. Test them explicitly, not by implication.

### 2. Workspace isolation

Every query is scoped by `workspaceId`. This is the multi-tenancy guarantee and a security
boundary, so it is tested as one:

- A member of workspace A requesting a workspace B resource gets **404** (not 403 — do not
  confirm the resource exists).
- Nested routes verify the whole chain: a task must belong to a board that belongs to the
  workspace in the URL.
- List endpoints never return rows from another workspace, including when a filter or
  search term would match them.
- Role checks: `OWNER`/`ADMIN`/`MEMBER`/`GUEST` each hit at least one allowed and one
  denied case.

Because the isolation rule is enforced by a guard rather than by the type system, these
tests are the only mechanical enforcement it has.

### 3. Auth flows

- Register, login, logout, session refresh
- Unauthenticated request to a protected route → **401**
- Expired or tampered session → **401**
- Invite acceptance grants exactly the intended role

## File conventions

| Kind                   | Location                       | Pattern                                              |
| ---------------------- | ------------------------------ | ---------------------------------------------------- |
| Unit                   | Colocated with the source file | `apps/api/src/task/task.service.spec.ts`             |
| Integration            | Separate test root             | `apps/api/test/task.e2e-spec.ts`                     |
| Test helpers/factories | Shared under the test root     | `apps/api/test/helpers/`, `apps/api/test/factories/` |
| Playwright (later)     | Repository-level               | `e2e/`                                               |

Nest's generator calls integration tests `*.e2e-spec.ts`; that name is kept for tooling
compatibility even though these are API integration tests, not browser e2e.

## Running tests

```bash
# Services must be up for integration tests
docker compose -f docker-compose.dev.yml up -d

pnpm --filter @kurultay/api test          # api unit
pnpm --filter @kurultay/api test:watch    # api unit, watch mode
pnpm --filter @kurultay/api test:e2e      # integration (needs Postgres)
pnpm --filter @kurultay/api test:cov      # api coverage report

pnpm --filter @kurultay/web test          # web unit (Vitest)
pnpm --filter @kurultay/web test:watch    # web unit, watch mode
```

Integration tests run against a **separate database** (`kurultay_test`), created and
migrated by the test setup. They never touch the development database.

## Writing tests

- **Arrange–Act–Assert**, with blank lines between the three parts.
- Test names describe behavior, not method names:
  `it('returns 404 when the board belongs to another workspace')`, not `it('findOne works')`.
- One behavior per test. If the name needs "and", split it.
- Use factories/builders for entities; do not hand-write the same 15-field task literal in
  twenty tests.
- **Each integration test cleans up after itself** — truncate the affected tables in
  `afterEach` or wrap the test in a transaction that is rolled back. Order-dependent test
  suites are a bug.
- Mock only what crosses a process boundary you do not control (email, third-party HTTP).
  Do not mock Prisma in integration tests — that is the point of them.
- No `setTimeout`-based waiting. Await the thing.
- A bug fix ships with a regression test that fails before the fix.

## Coverage

**Coverage is a signal first.** There is no repo-wide target and no ambition to raise a
number for its own sake.

- Use the report to find code that no test exercises, then decide whether that code
  _deserves_ a test.
- Low coverage on a positioning algorithm is a problem. Low coverage on a DTO or a barrel
  file is not.
- Gaming a threshold with assertion-free tests is worse than having no threshold. That is
  why floors are scoped to code that is already meaningfully tested, never applied globally
  to pull an average up.

### Where floors do exist

Two ratchets keep already-covered code from sliding back. Both fail CI.

| Scope               | Floor                                                 | Set in                      |
| ------------------- | ----------------------------------------------------- | --------------------------- |
| `apps/api` global   | statements 55 / branches 45 / functions 57 / lines 56 | `apps/api/jest.config.cjs`  |
| `apps/web` `app/**` | statements 85 / branches 90 / functions 85 / lines 85 | `apps/web/vitest.config.ts` |

Both sit a few points under the measurement taken when they were introduced — enough margin
that a routine refactor does not trip them, tight enough that deleting a test does.

`apps/web` has **no global floor**, deliberately. Overall web coverage is around 46% because
most page-level components are untested, and a global floor at that number would catch no
real regression while making the figure look like a target. `app/**` is floored because
route entrypoints are thin and uniform: a new page arriving with no test at all is exactly
the regression worth failing a build over. `apps/web/vitest.config.ts` carries the full
reasoning inline.

The global stance is revisited at 1.0, when the API is stable enough for a repo-wide floor to
be meaningful.

Both suites publish their HTML/JSON reports as CI artifacts (`api-coverage`, `web-coverage`)
on every run, passing or failing.

## CI

Every pull request runs, on `develop` and `main` as well:

| Step              | Command                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Build shared pkgs | `pnpm --filter @kurultay/shared-types build && pnpm --filter @kurultay/auth-access build` |
| Lint              | `pnpm lint`                                                                               |
| Format check      | `pnpm format:check`                                                                       |
| Typecheck         | `pnpm typecheck` (`tsc --noEmit` across workspaces)                                       |
| Audit             | `pnpm audit --audit-level high`                                                           |
| Unit tests (api)  | `pnpm --filter @kurultay/api test:cov`                                                    |
| Unit tests (web)  | `pnpm --filter @kurultay/web exec vitest run --coverage`                                  |
| Unit tests (pkgs) | `pnpm --filter "./packages/*" test`                                                       |
| Integration tests | `pnpm --filter @kurultay/api test:e2e` against Postgres and Redis service containers      |
| Build             | `pnpm build`                                                                              |

All steps must pass before merge. CI runs on pull requests to any branch (`pull_request.branches: ['**']`) and on pushes to `develop` and `main`. See [git-strategy.md](git-strategy.md#pull-request-process).

The workflow file is [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## See also

- [development.md](development.md) — running services locally
- [coding-standards.md](coding-standards.md) — code conventions tests assume
- [api-conventions.md](api-conventions.md) — status codes and error shapes to assert on
- [git-strategy.md](git-strategy.md) — PR requirements
- [roadmap.md](roadmap.md) — when CI and e2e land
