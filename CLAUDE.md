# Kurultay

Open-source Kanban-focused project management tool. `dravcore/kurultay` — AGPL-3.0.

## Architecture

- Monorepo (pnpm workspace) + **modular monolith** — no microservices
- `apps/api` (NestJS + Prisma + PostgreSQL + Redis + Socket.io)
- `apps/web` (Next.js App Router + Tailwind + shadcn/ui + @dnd-kit + Recharts)
- `packages/shared-types` (TS types shared between frontend/backend — DTOs, enums, socket events)
- Auth: Better Auth (organization plugin) · Deploy: Docker Compose

## Critical rules

- `Task.position` is **Float** (fractional indexing) — never use Int
- `dueDate` and `estimatedMinutes` are separate fields — do not merge them
- `priority` is kept separate from labels
- Multi-tenant isolation: every query is scoped by `workspaceId`, enforced at guard/interceptor level

## Git

- **Git Flow:** `main` (releases) ← `develop` (integration) ← `feature/*`, `fix/*`, `docs/*`, `chore/*`, plus `release/*`, `hotfix/*`
- **Conventional Commits** (`feat:`, `fix:`, `docs:` ...) · SemVer + `CHANGELOG.md`
- No direct commits to `main` or `develop` — all work goes through feature branch + PR

## Documentation

- English is canonical; Turkish copies live under `docs/tr/`; root has `README.md` + `README.tr.md`
- Naming: root community files UPPERCASE, `docs/` files kebab-case, ADRs `NNNN-title.md`
- Architecture/stack details: `docs/architecture.md`, `docs/tech-stack.md`
- Process: `docs/git-strategy.md`, `docs/coding-standards.md`, `docs/testing.md`, `docs/api-conventions.md`
- Decisions: `docs/decisions/` (lightweight ADRs) · Progress: `docs/roadmap.md`
