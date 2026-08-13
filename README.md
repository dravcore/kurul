# Kurultay

Open-source, Kanban-focused project management tool.

> 🌐 English (canonical) | [Türkçe](README.tr.md)

## Status

Kurultay’s **MVP feature set (Phases 1–9) is complete** (Phase 0 was docs/standards) — auth/workspaces, boards and
tasks, filtering, dashboard, activity/notifications, and realtime board sync. See
[docs/roadmap.md](docs/roadmap.md). Beyond-MVP items (email notifications, presence,
Playwright e2e, extra locales, …) remain listed under Beyond MVP.

## What is Kurultay?

A _kurultay_ was the great assembly of Turkic-Mongol tradition, where clans gathered to
discuss matters, reach decisions, and divide the work ahead. That's the shape of what this
tool does for a team: people gather around a board, discuss the work, decide what matters,
and divide tasks among themselves — tracked, prioritized, and visible to everyone.

Kurultay aims to be a self-hostable, AGPL-licensed alternative to commercial Kanban/PM tools
(Trello, Linear, Jira) for teams who want to own their data and their workflow.

## Features

Shipped in the MVP — sequencing history in [docs/roadmap.md](docs/roadmap.md):

- **Boards and columns** — classic Kanban layout with drag-and-drop reordering
- **Tasks** — multi-assignee, labels, priority (kept independent of labels), due date and
  time estimate as separate fields
- **Fractional-indexed ordering** — reordering a card only touches that card's position,
  never a full-list renumber
- **Workspaces** — multi-tenant from the ground up, every query scoped by workspace
- **Filtering and search** — board task filters with cursor pagination
- **Dashboard** — aggregation views and charts (including created vs completed)
- **Activity log and notifications** — in-app assignment, mention, due-soon; `/notifications`
- **Realtime sync** — board changes propagate live via Socket.io

## Quick start

```bash
git clone https://github.com/dravcore/kurultay.git
cd kurultay
cp .env.example .env   # set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm install
pnpm -r --filter @kurultay/shared-types --filter @kurultay/auth-access build   # shared packages, consumed from gitignored dist/
pnpm db:generate        # generate the Prisma client (gitignored, not created automatically)
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web: http://localhost:3000
- API health: http://localhost:4000/health

The app boots without SMTP configured, but invitations cannot be accepted until it is — the
dev compose file above already starts [Mailpit](https://mailpit.axllent.org/) so you can test
that flow locally without a real mail provider; see
[docs/development.md#smtp-and-mailpit](docs/development.md#smtp-and-mailpit).

Full stack in Docker: `docker compose up --build`. Day-to-day details:
[docs/development.md](docs/development.md).

## Stack

| Layer        | Choice                                                                    |
| ------------ | ------------------------------------------------------------------------- |
| Backend      | NestJS 11 + Prisma 7 + PostgreSQL 18 + Redis 8 + Socket.io                |
| Frontend     | Next.js 16 (App Router) + Tailwind CSS + shadcn/ui + @dnd-kit + Recharts  |
| Auth         | Better Auth (organization plugin → Workspace)                             |
| Email        | `nodemailer` over SMTP (invitation verification)                          |
| Shared types | `packages/shared-types` + `packages/auth-access` (DTOs / BA org AC roles) |
| Deployment   | Docker Compose                                                            |
| Architecture | Monorepo, modular monolith — no microservices                             |

Full rationale for each choice: [docs/tech-stack.md](docs/tech-stack.md) and
[docs/decisions/](docs/decisions/).

## Documentation

Start with the five-minute map: **[docs/README.md](docs/README.md)** (what to read for
product, coding, API, releases, roadmap).

| Doc                                                | Covers                                    |
| -------------------------------------------------- | ----------------------------------------- |
| [docs/architecture.md](docs/architecture.md)       | Module map, data model                    |
| [docs/design.md](docs/design.md)                   | UI/UX language                            |
| [docs/development.md](docs/development.md)         | Local setup and daily commands            |
| [docs/api-conventions.md](docs/api-conventions.md) | REST, errors, pagination                  |
| [docs/roadmap.md](docs/roadmap.md)                 | MVP done; beyond-MVP backlog              |
| [docs/decisions/](docs/decisions/)                 | ADRs                                      |
| [docs/archive/](docs/archive/)                     | Historical specs, plans, phase checklists |

## Contributing

Bug reports, feature ideas, and design feedback are welcome and genuinely useful. **Outside
code, documentation, and translation pull requests are not accepted** — the codebase stays
single-authored, indefinitely ([ADR 0015](docs/decisions/0015-no-external-contributions.md)).
Kurultay is issue-first: propose before you implement. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the process, and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for how we work together.

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[AGPL-3.0](LICENSE).
