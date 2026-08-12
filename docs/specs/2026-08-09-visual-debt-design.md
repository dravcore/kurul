# Visual debt and Phase 4 groundwork — design

**Date:** 2026-08-09 · **Status:** shipped · **Scope:** `apps/web`

Closes the gaps between the Phase 3 UI and [design.md](../design.md), and lays the visual
groundwork Phase 4 (tasks and drag-and-drop) will build on. Phase 4's own UI — task cards,
the detail panel, drag interactions — is out of scope and belongs to the Phase 4 plan.

> **Shipped** to `develop` via PRs #11 (primitives), #15 (shell chrome), #13 (auth),
> #14 (board polish). Implementation checklist:
> [plans/2026-08-09-visual-debt.md](../plans/2026-08-09-visual-debt.md).

## Context

Phase 3 landed the token set (`globals.css` matches design.md §3), the font trio, the app
shell, and board/column CRUD. An audit against design.md found the following debt:

1. Auth screens are off-spec: raw `<button>`, `text-red-600` (a non-token color — a defect
   per design.md §1.4), no Fraunces display step, no damga mark.
2. No shared topbar; design.md §4 specifies a 48px sticky topbar. Only the board page has
   an ad-hoc header; the dashboard has none.
3. The workspace switcher is a native `<select>` and disappears entirely in the collapsed
   56px rail — workspaces cannot be switched from the rail.
4. The sancak rail is rendered per-item and static; design.md §2 says it slides between
   positions.
5. No toast system; action errors render as inline `<p>` elements. design.md §5 requires
   toast + "Try again" for failed optimistic actions.
6. No type-scale utilities; page titles use ad-hoc `text-3xl` / `text-base` instead of the
   §3 steps (`display 40/44`, `title-lg 20/28`, …).
7. The `prefers-reduced-motion` rule zeroes all animation; §5 says motion drops but opacity
   and color transitions stay.
8. Board-list cards have no hover/focus treatment, `DamgaMark` is duplicated in two files,
   and the first-paint column stagger (§5, the board's one orchestrated moment) is missing.

## Goals

- Every screen shipped so far conforms to design.md: tokens only, correct type steps, one
  signature element per view, states as specified.
- The primitives Phase 4 needs on day one exist: toast with retry, elevation tokens for the
  drag preview, a reusable sliding sancak rail, reduced-motion behavior that keeps color.

## Non-goals

- Task cards, task detail panel, drag-and-drop visuals (Phase 4).
- `⌘K` command palette and other reserved shortcuts (Phase 4+).
- Turkish UI catalog (post-Phase 5); charts (Phase 7). All new strings still go through
  next-intl into `messages/en.json`.

## Design

### Layer 1 — primitives (`feat/design-primitives`)

**Type scale.** The seven steps of design.md §3 become Tailwind v4 `@theme` font-size
tokens (size + line-height + weight guidance), yielding `text-display`, `text-title-lg`,
`text-title`, `text-body`, `text-small`, `text-micro` utilities. Existing ad-hoc sizes are
migrated wherever a component already deviates.

**Reduced motion.** Replace the blanket `0.01ms` rule: under `prefers-reduced-motion:
reduce`, transitions are restricted to `color`, `background-color`, `border-color`,
`opacity` (movement drops, state changes stay visible). The sancak rail jumps instead of
sliding; the column stagger collapses to a plain opacity fade.

**`DamgaMark`.** The two copies move to `components/brand/damga-mark.tsx`
(`components/ui/` stays shadcn-generated output only, per coding-standards). The mark is
redrawn as a more distinctive tamga form — still a single-stroke geometric mark on a 24px
grid at 1.5px stroke, sized 64/96px by prop.

**Toast.** shadcn `sonner`, themed with tokens: card surface, 1px border, `translateY`
enter at 200ms `--ease-out`, action-button support ("Try again"). This is the relief
channel design.md §5 requires for failed optimistic updates and the prerequisite for
Phase 4's drag-failure flow.

**Elevation tokens.** `--shadow-overlay` (dialogs, popovers) and `--shadow-drag` (drag
preview) defined in `globals.css`; shadows appear nowhere else, per §3.

### Layer 2 — shell chrome (`feat/shell-chrome`)

**Topbar.** A shared 48px sticky topbar component with title and actions slots. The board
page's ad-hoc header migrates into it (back link, board name, overflow menu); the dashboard
adopts it (page title, "Create board"). The shell's conditional `p-6` special case goes
away — the topbar owns the top edge, content owns its own padding.

**Workspace switcher.** The native `<select>` becomes a shadcn DropdownMenu trigger:
workspace-initial avatar + name + chevron, pinned at the top of the sidebar per §4. In the
collapsed rail it remains as the avatar button, fixing the "no switching from the rail"
defect. "Create workspace" moves into this menu.

**Sliding sancak rail.** One rail element per nav container, positioned by measuring the
active item and moved with `transform` at 140ms `--ease-out` (§5's press/rail timing). The
component is written to be reusable — Phase 4 attaches the same mechanism to focused
columns and selected cards.

**Shell loading.** The centered "loading" text becomes a skeleton that matches the final
layout: sidebar strip plus content blocks, `--muted`, 1.6s opacity pulse (§6).

### Layer 3 — auth screens (`feat/auth-visual`)

Login, register, and invite get the identity treatment — auth is the only product surface
where Fraunces is allowed (§3):

- One Fraunces `display` (40/44) headline per screen; one damga mark.
- `AuthFormField` reworked on `ui/input` + `ui/label`; the raw `<button>` becomes
  `ui/button` (the screen's single copper element).
- `text-red-600` and all `text-[var(--…)]` arbitrary syntax replaced with token utilities;
  error text uses `text-destructive` and follows the §6 error-copy rules.

### Layer 4 — board polish (`feat/board-polish`)

- **Column stagger:** on first board paint only, columns enter at 40ms intervals
  (opacity + small translate, `--ease-out`) — the view's one orchestrated moment.
- **Board-list cards:** hover raises the surface (`--muted`) and strengthens the border
  (`--border-strong`); keyboard focus shows the standard ring. Card skeletons match real
  card height and shape.
- **Toasts wired:** column move/seed failures and other action errors move from inline
  `<p>` to toasts with a retry action where the action is retryable.

## Error handling

No new error surfaces; existing `ApiError` branching stays. The change is presentational:
retryable action failures surface as toasts with a "Try again" action, field errors stay
inline under fields, and load errors keep their in-place error block with a retry control.

## Testing and verification

Per PR: `pnpm lint` + `pnpm build`; manual pass in both themes (dark is selected, not
derived); a keyboard-only tour of every touched screen; and a grep gate — no raw hex, no
Tailwind palette colors (`text-red-*` etc.), and no `text-[var(--…)]` arbitrary values in
components. Existing unit/e2e suites must stay green; no new test infrastructure is
introduced by this work.

## Sequencing

Four PRs, in order, each leaving `develop` shippable: primitives → shell chrome → auth →
board polish. Later layers consume earlier ones (topbar uses the type scale; board polish
uses toasts), so the order is a dependency chain, not a preference.
