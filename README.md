# Kurultay

Open-source, Kanban-focused project management tool.

> 🌐 English (canonical) | [Türkçe](README.tr.md)

## Status

Kurultay is **pre-MVP**. The project is currently docs-first: architecture, stack, and
process decisions are being written down before any application code is scaffolded. The
`apps/api` and `apps/web` skeleton described below does not exist in this repository yet —
see [docs/roadmap.md](docs/roadmap.md) for what's planned and in what order.

## What is Kurultay?

A *kurultay* was the great assembly of Turkic-Mongol tradition, where clans gathered to
discuss matters, reach decisions, and divide the work ahead. That's the shape of what this
tool does for a team: people gather around a board, discuss the work, decide what matters,
and divide tasks among themselves — tracked, prioritized, and visible to everyone.

Kurultay aims to be a self-hostable, AGPL-licensed alternative to commercial Kanban/PM tools
(Trello, Linear, Jira) for teams who want to own their data and their workflow.

## Features

Planned for the initial release — see [docs/roadmap.md](docs/roadmap.md) for sequencing:

- **Boards and columns** — classic Kanban layout with drag-and-drop reordering
- **Tasks** — multi-assignee, labels, priority (kept independent of labels), due date and
  time estimate as separate fields
- **Fractional-indexed ordering** — reordering a card only touches that card's position,
  never a full-list renumber
- **Workspaces** — multi-tenant from the ground up, every query scoped by workspace
- **Dashboard** — aggregation views and charts over task/board activity
- **Realtime sync** — board changes propagate live via Socket.io
- **Activity log and notifications**

## Quick start

*Coming with the skeleton — not runnable yet.* Once `apps/api` and `apps/web` exist, the
planned flow is:

```bash
git clone https://github.com/dravcore/kurultay.git
cd kurultay
cp .env.example .env
docker compose up
```

Full local development setup (without Docker, with hot reload) is documented as the
pre-skeleton contract in [docs/development.md](docs/development.md).

## Stack

| Layer | Choice |
|---|---|
| Backend | NestJS + Prisma + PostgreSQL + Redis + Socket.io |
| Frontend | Next.js (App Router) + Tailwind CSS + shadcn/ui + @dnd-kit + Recharts |
| Auth | Better Auth (organization plugin) |
| Shared types | `packages/shared-types` (TS types shared between frontend/backend) |
| Deployment | Docker Compose |
| Architecture | Monorepo, modular monolith — no microservices |

Full rationale for each choice: [docs/tech-stack.md](docs/tech-stack.md) and
[docs/decisions/](docs/decisions/).

## Documentation

| Doc | Covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Module map, data model overview |
| [docs/tech-stack.md](docs/tech-stack.md) | Stack choices and rationale |
| [docs/project-skeleton.md](docs/project-skeleton.md) | Planned repo layout, first Prisma schema |
| [docs/development.md](docs/development.md) | Environment setup, daily workflow, commands |
| [docs/coding-standards.md](docs/coding-standards.md) | TS/NestJS/Next.js conventions |
| [docs/git-strategy.md](docs/git-strategy.md) | Git Flow, Conventional Commits, releases |
| [docs/testing.md](docs/testing.md) | Test layers, tools, expectations |
| [docs/api-conventions.md](docs/api-conventions.md) | REST naming, error format, pagination |
| [docs/roadmap.md](docs/roadmap.md) | Phases and progress |
| [docs/decisions/](docs/decisions/) | Lightweight architecture decision records |

## Contributing

Kurultay is pre-skeleton and issue-first: propose before you implement. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the process, and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for how we work together.

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[AGPL-3.0](LICENSE).
