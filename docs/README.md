# Documentation

Map of Kurultay docs, language policy, and what belongs in the archive.

> 🌐 English (canonical) · Turkish copies live under [`tr/`](tr/)

## Language policy

- **English is canonical** for behavior, architecture, and process.
- Turkish lives under `docs/tr/` with the same filenames; root community files use
  `README.tr.md` as the sibling of `README.md`.
- When EN and TR disagree, fix EN first, then sync TR. TR banners may note that a
  translation can lag.

## Active docs

| Doc                                                                          | Covers                                       |
| ---------------------------------------------------------------------------- | -------------------------------------------- |
| [architecture.md](architecture.md)                                           | Module map, data model, runtime evolution    |
| [tech-stack.md](tech-stack.md)                                               | Stack choices and rationale                  |
| [development.md](development.md)                                             | Env setup, Compose, pnpm scripts, day-to-day |
| [coding-standards.md](coding-standards.md)                                   | TS / NestJS / Next.js conventions            |
| [design.md](design.md)                                                       | UI/UX language                               |
| [git-strategy.md](git-strategy.md)                                           | Git Flow, Conventional Commits, releases     |
| [testing.md](testing.md)                                                     | Test layers and expectations                 |
| [api-conventions.md](api-conventions.md)                                     | REST naming, errors, pagination              |
| [roadmap.md](roadmap.md)                                                     | Phases and MVP / beyond-MVP status           |
| [decisions/](decisions/)                                                     | Architecture decision records (ADRs)         |
| [specs/2026-08-09-phase-8-deferred.md](specs/2026-08-09-phase-8-deferred.md) | Active deferred notes for Phase 8 follow-ups |

Root community files (`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, …)
sit outside `docs/` because GitHub treats them specially.

## Historical / demoted (still in tree)

| Doc                                         | Status                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [project-skeleton.md](project-skeleton.md)  | **Historical Phase 1 scaffold** — prefer [architecture.md](architecture.md) and the live repo for current layout.                                |
| Phase design specs under [`specs/`](specs/) | Shipped design records kept in place so [`CHANGELOG.md`](../CHANGELOG.md) links stay stable. Treat as historical — except `phase-8-deferred.md`. |

## Archive policy

`docs/archive/` holds **finished implementation plans** and **meta-specs** that are no
longer day-to-day reading:

| Path             | Contents                                                                       |
| ---------------- | ------------------------------------------------------------------------------ |
| `archive/plans/` | Completed implementation plans formerly under `docs/plans/`                    |
| `archive/specs/` | Historical meta-specs (e.g. docs-structure) that are not linked from CHANGELOG |

**Do not archive** CHANGELOG-linked phase design specs unless you update every
`docs/specs/...` link in `CHANGELOG.md` to `docs/archive/specs/...` in the same PR.

## Plans vs specs

- **Specs** (`docs/specs/`) — design intent for a phase or theme.
- **Plans** (`docs/archive/plans/`) — step-by-step implementation checklists used during a build.
- After MVP, new work should open as issues; archive finished plans rather than leaving
  them next to active docs.
