# 0003. Frontend Stack: Next.js + Tailwind + shadcn/ui + @dnd-kit + Recharts

**Status:** Accepted
**Date:** 2026-08-08

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0003-frontend-stack.md)

## Context

The frontend must render an interactive kanban board (drag-and-drop reordering),
a styled component system, and a dashboard with charts, while staying
lightweight enough for a solo/small-team codebase to maintain.

## Decision

**Next.js (App Router)** + **Tailwind CSS** + **shadcn/ui** + **@dnd-kit** +
**Recharts**.

## Rationale

- `react-beautiful-dnd` is deprecated — Atlassian withdrew from maintaining it,
  so it is not a viable pick for new work.
- **@dnd-kit** is the 2026 default for most React drag-and-drop needs: small
  (6KB core), accessible (keyboard and screen-reader support), framework-agnostic,
  and actively maintained. Linear itself uses `@dnd-kit` for issue ordering.
- At typical kanban scale (50–200 cards per board) there is no measurable
  performance difference between `@dnd-kit` and Atlassian's newer
  `pragmatic-drag-and-drop`. That library only pulls ahead at 1000+ items, and
  it requires hand-writing collision detection — not worth the complexity yet.
- **Recharts** is the safest default for most React dashboards: strong ecosystem
  adoption, an understandable component API, SVG rendering, good fit with
  shadcn/ui, MIT-licensed. Its bundle (~290KB) is not the lightest option; if
  chart count or dataset size grows substantially, a Canvas-based library
  (Chart.js, Apache ECharts) should be reconsidered.

## Consequences

- Accessible drag-and-drop out of the box, without building keyboard support
  ourselves.
- Consistent visual language via Tailwind + shadcn/ui reduces one-off styling.
- Ships dashboards quickly with Recharts' straightforward API.
- `@dnd-kit`'s collision detection may need custom tuning as board interactions
  grow more complex (nested sortables, multi-column drag).
- Recharts' bundle weight will need revisiting once analytics features expand —
  this is a deliberate "revisit later" trade-off, not an oversight.

## Alternatives considered

| Alternative | Why not |
|---|---|
| react-beautiful-dnd | Deprecated; Atlassian withdrew maintenance |
| pragmatic-drag-and-drop | Only wins at 1000+ item scale; requires hand-written collision detection — premature for current board sizes |
| Chart.js / Apache ECharts | Canvas-based, better for very large datasets, but heavier integration and less idiomatic with shadcn/ui right now |
