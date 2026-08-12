# Visual Debt and Phase 4 Groundwork — Implementation Plan

> **Status: shipped** — all four layers merged to `develop` (PRs #11, #15, #13, #14).
> Spec: `docs/archive/specs/2026-08-09-visual-debt-design.md`. Task checkboxes below are retained
> as a historical record and marked complete.

> **For agentic workers:** Historical plan — do not re-execute. Steps used checkbox
> (`- [x]`) syntax for tracking; all tasks are complete.

**Goal:** Bring every shipped `apps/web` screen into conformance with `docs/design.md` and land the primitives Phase 4 needs (type scale, toast, elevation tokens, sliding sancak rail, reduced-motion policy).

**Architecture:** Four stacked layers, each its own branch and PR: primitives → shell chrome → auth screens → board polish. Later layers consume earlier ones, so the order is a dependency chain. Spec: `docs/archive/specs/2026-08-09-visual-debt-design.md`.

**Tech Stack:** Next.js 16 App Router, Tailwind v4 (`@theme` tokens in `apps/web/app/globals.css`), shadcn/ui, sonner, next-intl, lucide-react.

## Global Constraints

- Run all package scripts from the repo root: `pnpm --filter @kurultay/web lint` / `typecheck` / `build`. Lint runs with `--max-warnings 0`.
- **Tokens only:** no raw hex, no Tailwind palette colors (`text-red-600` etc.), and no `text-[var(--color-…)]`-style arbitrary values in components. Use the utilities generated from `globals.css` (`text-destructive`, `bg-signature-subtle`, …).
- **Every user-visible string** goes through next-intl (`apps/web/messages/en.json`); no string literals in JSX. English, sentence case.
- `apps/web/components/ui/` is shadcn-generated output: only shadcn-style additions (the sonner wrapper) and the shadow-token class swap are allowed there. Brand/custom components live in `components/brand/` or `components/layout/`.
- Git Flow + Conventional Commits. Branch layout: `feat/design-primitives` from `develop`; each later layer branches from the previous layer's branch (stacked). Each layer ends with a PR to `develop` (retarget stacked PRs after the parent merges). PR bodies end with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- No new test infrastructure. Verification per task = lint + typecheck; per layer = build + the grep gate in Task 6/12/15/19 + a manual two-theme pass by the reviewer.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## Layer 1 — primitives (branch `feat/design-primitives`)

### Task 1: Type-scale tokens

**Files:**

- Modify: `apps/web/app/globals.css` (the `@theme inline` block, after `--radius`)

**Interfaces:**

- Produces: utilities `text-display`, `text-title-lg`, `text-title`, `text-body`, `text-small`, `text-micro`, `font-strong` — consumed by Tasks 7, 8, 14.

- [x] **Step 1: Create the branch**

```bash
git checkout develop && git pull && git checkout -b feat/design-primitives
```

- [x] **Step 2: Add font-size tokens to the `@theme inline` block**

In `apps/web/app/globals.css`, inside `@theme inline { … }`, after the `--radius: 6px;` line, add:

```css
--text-display: 40px;
--text-display--line-height: 44px;
--text-display--font-weight: 600;
--text-title-lg: 20px;
--text-title-lg--line-height: 28px;
--text-title-lg--font-weight: 600;
--text-title: 16px;
--text-title--line-height: 24px;
--text-title--font-weight: 600;
--text-body: 13px;
--text-body--line-height: 18px;
--text-small: 12px;
--text-small--line-height: 16px;
--text-micro: 11px;
--text-micro--line-height: 14px;
--font-weight-strong: 550;
```

These are the design.md §3 steps. Tailwind v4 derives `text-<name>` utilities (size + line-height + weight) and `font-strong` from these names. Do not remove the existing default utilities; migration happens screen by screen in later tasks.

- [x] **Step 3: Verify**

Run: `pnpm --filter @kurultay/web typecheck && pnpm --filter @kurultay/web build`
Expected: both pass (tokens are additive; nothing consumes them yet).

- [x] **Step 4: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(web): add design.md type-scale tokens"
```

### Task 2: Reduced-motion policy

**Files:**

- Modify: `apps/web/app/globals.css:179-187` (the `prefers-reduced-motion` block)

**Interfaces:**

- Produces: the global rule that movement transitions drop while color/opacity transitions stay. Task 16's stagger defines its own reduced-motion fallback on top of this.

- [x] **Step 1: Replace the blanket rule**

Replace the existing block:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

with:

```css
/* Reduced motion drops movement but keeps state changes visible:
   transitions may only animate color and opacity; keyframe animations
   declare their own reduced variants where they are defined. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-property: color, background-color, border-color, opacity !important;
  }
}
```

This keeps the skeleton's opacity pulse and color fades (per design.md §5 "fewer and gentler, not zero") while transform/width transitions (sidebar collapse, sancak rail slide) snap instantly.

- [x] **Step 2: Verify**

Run: `pnpm --filter @kurultay/web build`
Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(web): keep color and opacity under prefers-reduced-motion"
```

### Task 3: Shared DamgaMark

**Files:**

- Create: `apps/web/components/brand/damga-mark.tsx`
- Modify: `apps/web/components/board/board-list.tsx:23-39` (delete local `DamgaMark`), `apps/web/components/board/board-view.tsx:30-46` (delete local `DamgaMark`)

**Interfaces:**

- Produces: `DamgaMark({ size?: number; className?: string })` — default size 96; consumed by Tasks 3 (board files) and 14 (auth layout).

- [x] **Step 1: Create the component**

Create `apps/web/components/brand/damga-mark.tsx`:

```tsx
import { cn } from '@/lib/utils';

/* Hand-authored tamga: horns, stem, ground line — 24px grid, 1.5px stroke
   (design.md §2). The only surface family where this mark may appear is
   empty states, auth, and the wordmark. */
export function DamgaMark({
  size = 96,
  className,
}: Readonly<{
  size?: number;
  className?: string;
}>): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('text-signature', className)}
      aria-hidden
    >
      <path d="M12 21V9" />
      <path d="M12 9C8.7 9 6 6.3 6 3" />
      <path d="M12 9c3.3 0 6-2.7 6-6" />
      <path d="M8 21h8" />
    </svg>
  );
}
```

- [x] **Step 2: Replace the two local copies**

In `board-list.tsx` and `board-view.tsx`: delete the local `function DamgaMark(…) { … }` declarations, add `import { DamgaMark } from '@/components/brand/damga-mark';`, and change the call sites from `<DamgaMark size={96} />` to `<DamgaMark />` (96 is now the default).

- [x] **Step 3: Verify**

Run: `pnpm --filter @kurultay/web lint && pnpm --filter @kurultay/web typecheck`
Expected: PASS, no unused imports.

- [x] **Step 4: Commit**

```bash
git add apps/web/components/brand/damga-mark.tsx apps/web/components/board/board-list.tsx apps/web/components/board/board-view.tsx
git commit -m "refactor(web): extract shared DamgaMark brand component"
```

### Task 4: Toast infrastructure (sonner)

**Files:**

- Create: `apps/web/components/ui/sonner.tsx`
- Modify: `apps/web/package.json` (dependency), `apps/web/app/layout.tsx:39-47` (mount)

**Interfaces:**

- Produces: `<Toaster />` mounted globally; `toast` from `'sonner'` callable anywhere client-side. `toast.error(message, { action: { label, onClick } })` is the retry pattern Task 18 uses.

- [x] **Step 1: Install**

```bash
pnpm --filter @kurultay/web add sonner
```

- [x] **Step 2: Create the themed wrapper**

Create `apps/web/components/ui/sonner.tsx` (shadcn's sonner component, themed with Kurultay tokens):

```tsx
'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme as ToasterProps['theme']}
      position="bottom-right"
      style={
        {
          '--normal-bg': 'var(--card)',
          '--normal-text': 'var(--foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius-md)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
```

- [x] **Step 3: Mount it**

In `apps/web/app/layout.tsx`, add `import { Toaster } from '@/components/ui/sonner';` and render it inside `ThemeProvider`, after the intl provider:

```tsx
<ThemeProvider>
  <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
  <Toaster />
</ThemeProvider>
```

- [x] **Step 4: Verify**

Run: `pnpm --filter @kurultay/web lint && pnpm --filter @kurultay/web build`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/components/ui/sonner.tsx apps/web/app/layout.tsx
git commit -m "feat(web): add token-themed sonner toast infrastructure"
```

### Task 5: Elevation tokens

**Files:**

- Modify: `apps/web/app/globals.css` (`:root` and `@theme inline`), `apps/web/components/ui/dialog.tsx:56`, `apps/web/components/ui/dropdown-menu.tsx:36,204`

**Interfaces:**

- Produces: utilities `shadow-overlay` (dialogs, popovers) and `shadow-drag` (Phase 4 drag preview). Per design.md §3, shadows exist nowhere else.

- [x] **Step 1: Define the tokens**

In `globals.css` `:root`, after the `--ease-*` block, add (values shared by both themes — dark depth comes from surface steps, not bigger shadows):

```css
--elevation-overlay: 0 8px 24px rgb(0 0 0 / 0.12), 0 2px 6px rgb(0 0 0 / 0.08);
--elevation-drag: 0 12px 32px rgb(0 0 0 / 0.18), 0 4px 8px rgb(0 0 0 / 0.1);
```

In the `@theme inline` block add:

```css
--shadow-overlay: var(--elevation-overlay);
--shadow-drag: var(--elevation-drag);
```

- [x] **Step 2: Swap the hardcoded shadows**

- `dialog.tsx:56` — replace `shadow-lg` with `shadow-overlay`.
- `dropdown-menu.tsx:36` — replace `shadow-md` with `shadow-overlay`.
- `dropdown-menu.tsx:204` (the sub-menu content) — replace `shadow-lg` with `shadow-overlay`.

- [x] **Step 3: Verify**

Run: `pnpm --filter @kurultay/web build && grep -rn "shadow-lg\|shadow-md" apps/web/components apps/web/app --include='*.tsx'`
Expected: build PASS; grep finds nothing.

- [x] **Step 4: Commit**

```bash
git add apps/web/app/globals.css apps/web/components/ui/dialog.tsx apps/web/components/ui/dropdown-menu.tsx
git commit -m "feat(web): add elevation tokens, route overlay shadows through them"
```

### Task 6: Layer 1 gate and PR

**Files:** none (verification only)

- [x] **Step 1: Full verification**

```bash
pnpm --filter @kurultay/web lint && pnpm --filter @kurultay/web typecheck && pnpm --filter @kurultay/web build
```

Expected: all PASS.

- [x] **Step 2: Grep gate**

```bash
grep -rnE "text-(red|green|blue|yellow|orange|gray|slate|zinc)-[0-9]|#[0-9a-fA-F]{3,8}\b" apps/web/components apps/web/app --include='*.tsx'
```

Expected: no matches in files this layer touched (auth files still match until Layer 3).

- [x] **Step 3: Push and open the PR**

```bash
git push -u origin feat/design-primitives
gh pr create --base develop --title "feat: design primitives (type scale, toast, elevation, reduced motion)" --body "$(cat <<'EOF'
Layer 1 of docs/archive/specs/2026-08-09-visual-debt-design.md: type-scale tokens, reduced-motion policy that keeps color/opacity, shared DamgaMark, token-themed sonner toasts, elevation tokens.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Layer 2 — shell chrome (branch `feat/shell-chrome` from `feat/design-primitives`)

### Task 7: Topbar component

**Files:**

- Create: `apps/web/components/layout/topbar.tsx`

**Interfaces:**

- Produces: `Topbar({ title, leading?, actions? })` — `title: string` renders as the route's single `h1`; consumed by Task 8.

- [x] **Step 1: Create the component**

```tsx
export function Topbar({
  title,
  leading,
  actions,
}: Readonly<{
  title: string;
  leading?: React.ReactNode;
  actions?: React.ReactNode;
}>): React.ReactElement {
  return (
    <header className="sticky top-0 z-20 flex h-[var(--topbar-height)] shrink-0 items-center gap-3 border-b border-border bg-background/95 px-3 backdrop-blur-sm">
      {leading}
      <h1 className="min-w-0 flex-1 truncate text-title">{title}</h1>
      {actions}
    </header>
  );
}
```

(`text-title` = 16/24/600 from Task 1 — `title-lg` is for panel titles on taller surfaces; the 48px bar takes the 16px step.)

- [x] **Step 2: Verify and commit**

Run: `pnpm --filter @kurultay/web lint && pnpm --filter @kurultay/web typecheck` — expected PASS.

```bash
git checkout -b feat/shell-chrome
git add apps/web/components/layout/topbar.tsx
git commit -m "feat(web): add shared 48px sticky topbar"
```

### Task 8: Adopt the topbar; drop the shell padding special case

**Files:**

- Modify: `apps/web/components/board/board-view.tsx:182-204`, `apps/web/app/(app)/dashboard/page.tsx`, `apps/web/components/board/board-list.tsx:100-111`, `apps/web/components/layout/app-shell.tsx:40-45`, `apps/web/app/(app)/workspaces/new/page.tsx`

**Interfaces:**

- Consumes: `Topbar` (Task 7).
- Produces: every `(app)` route renders exactly one `Topbar` with the route's `h1`; the shell no longer injects padding.

- [x] **Step 1: Board view**

In `board-view.tsx`, replace the `<header>…</header>` block (lines 182–204) with a `Topbar` usage — same children, new frame:

```tsx
<Topbar
  title={board.name}
  leading={
    <Button asChild variant="ghost" size="icon-sm" aria-label={t('backToBoards')}>
      <Link href="/dashboard">
        <ArrowLeft />
      </Link>
    </Button>
  }
  actions={
    canMutate ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('boardMenu')}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <Plus />
            {t('column.createAction')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : undefined
  }
/>
```

Also apply `Topbar` to the loading branch (lines 156–159): replace the skeleton header `<div>` with `<div className="flex h-[var(--topbar-height)] items-center border-b border-border px-3"><Skeleton className="h-5 w-40" /></div>` unchanged — the loading state keeps its plain frame (a `Topbar` needs a real title).

- [x] **Step 2: Dashboard**

`app/(app)/dashboard/page.tsx` becomes:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { BoardList } from '@/components/board/board-list';
import { Topbar } from '@/components/layout/topbar';

export default function DashboardPage(): React.ReactElement {
  const t = useTranslations('app.dashboard');
  return (
    <>
      <Topbar title={t('title')} />
      <div className="flex-1 overflow-y-auto p-6">
        <BoardList />
      </div>
    </>
  );
}
```

In `board-list.tsx` (lines 100–111), the `Topbar` now owns the route's `h1`, so demote the list header: replace the `<h1 …>{t('listTitle')}</h1>` element with nothing and keep the subtitle + create-button row:

```tsx
<div className="flex items-center justify-between gap-3">
  <p className="text-body text-muted-foreground">{t('listSubtitle')}</p>
  {canCreate ? (
    <Button type="button" onClick={() => setCreateOpen(true)}>
      {t('createAction')}
    </Button>
  ) : null}
</div>
```

(`listTitle` stays in `en.json`; it is still unused only if nothing references it — leave the key, `dashboard.title` covers the heading.)

- [x] **Step 3: Shell**

In `app-shell.tsx`, replace

```tsx
<div className={cn('flex min-w-0 flex-1 flex-col', !isBoardRoute && 'p-6')}>{children}</div>
```

with

```tsx
<div className="flex min-w-0 flex-1 flex-col">{children}</div>
```

and remove the now-unused `isBoardRoute`, `usePathname`, and `cn` imports if nothing else uses them.

- [x] **Step 4: Workspaces/new page**

`app/(app)/workspaces/new/page.tsx` previously relied on the shell's `p-6`. Change its root `<main>` className from `"mx-auto flex max-w-md flex-col gap-4"` to `"mx-auto flex w-full max-w-md flex-col gap-4 p-6"` (max-w-md is within design.md §4's 720px form ceiling; the token cleanup of this file happens in Task 14 Step 5).

- [x] **Step 5: Verify**

Run: `pnpm --filter @kurultay/web lint && pnpm --filter @kurultay/web typecheck && pnpm --filter @kurultay/web build`
Expected: PASS. Manual: dashboard and board both show one 48px sticky topbar; workspaces/new is padded.

- [x] **Step 6: Commit**

```bash
git add apps/web/components/board/board-view.tsx apps/web/app/\(app\)/dashboard/page.tsx apps/web/components/board/board-list.tsx apps/web/components/layout/app-shell.tsx apps/web/app/\(app\)/workspaces/new/page.tsx
git commit -m "feat(web): adopt shared topbar on board and dashboard routes"
```

### Task 9: Workspace switcher dropdown

**Files:**

- Create: `apps/web/components/layout/workspace-switcher.tsx`
- Modify: `apps/web/components/layout/app-sidebar.tsx:64-79,104-111`, `apps/web/messages/en.json` (`app.shell`)

**Interfaces:**

- Consumes: `useWorkspaceContext()` — `workspaces: WorkspaceDto[]`, `activeId: string`, `onSwitch(id): Promise<void>`.
- Produces: `WorkspaceSwitcher({ collapsed: boolean })`, rendered pinned at the sidebar top in both expanded and collapsed states.

- [x] **Step 1: Create the component**

```tsx
'use client';

import Link from 'next/link';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useWorkspaceContext } from './workspace-provider';

export function WorkspaceSwitcher({
  collapsed,
}: Readonly<{ collapsed: boolean }>): React.ReactElement {
  const t = useTranslations('app.shell');
  const { workspaces, activeId, onSwitch } = useWorkspaceContext();
  const active = workspaces.find((workspace) => workspace.id === activeId);
  const initial = (active?.name ?? '?').charAt(0).toLocaleUpperCase('en-US');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('switchWorkspace')}
          className={cn(
            'h-10 justify-start gap-2 px-2',
            collapsed ? 'w-10 justify-center px-0' : 'w-full',
          )}
        >
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-signature-subtle text-small font-medium text-signature"
          >
            {initial}
          </span>
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1 truncate text-left text-body">{active?.name}</span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.id} onClick={() => void onSwitch(workspace.id)}>
            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
            {workspace.id === activeId ? <Check /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/workspaces/new">
            <Plus />
            {t('createWorkspace')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [x] **Step 2: Add the string**

In `messages/en.json` under `app.shell`, add: `"switchWorkspace": "Switch workspace"`.

- [x] **Step 3: Wire into the sidebar**

In `app-sidebar.tsx`:

- Delete the `<label>…<select>…</label>` block (lines 64–79).
- Render `<WorkspaceSwitcher collapsed={collapsed} />` directly under the title row, above the `<Separator />`, wrapped in `<div className={cn('mb-3', collapsed ? 'px-2' : 'px-3')}>`. It renders in **both** collapsed and expanded states — this fixes switching being impossible from the 56px rail.
- Delete the "New workspace" `<Link>` from the nav (lines 104–111) — it now lives in the switcher menu.
- Drop the now-unused `onSwitch` destructuring if the sidebar no longer references it.

- [x] **Step 4: Verify**

Run: `pnpm --filter @kurultay/web lint && pnpm --filter @kurultay/web typecheck`
Expected: PASS. Manual: switcher opens in both sidebar widths; active workspace shows a check; "New workspace" navigates.

- [x] **Step 5: Commit**

```bash
git add apps/web/components/layout/workspace-switcher.tsx apps/web/components/layout/app-sidebar.tsx apps/web/messages/en.json
git commit -m "feat(web): replace native select with workspace switcher dropdown"
```

### Task 10: Sliding sancak rail

**Files:**

- Create: `apps/web/components/layout/sancak-rail.tsx`
- Modify: `apps/web/components/layout/app-sidebar.tsx` (nav block, lines 83–112 after Task 9)

**Interfaces:**

- Produces: `useSancakRail(containerRef, deps)` returning `{ top, height } | null` measured from the element marked `data-rail-active="true"`, and `SancakRail({ box })` rendering the 2px copper rule. Phase 4 reuses both for focused columns / selected cards.

- [x] **Step 1: Create hook and component**

```tsx
'use client';

import { useEffect, useState, type RefObject } from 'react';

export interface SancakRailBox {
  top: number;
  height: number;
}

export function useSancakRail(
  containerRef: RefObject<HTMLElement | null>,
  deps: readonly unknown[],
): SancakRailBox | null {
  const [box, setBox] = useState<SancakRailBox | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>('[data-rail-active="true"]');
    if (!active) {
      setBox(null);
      return;
    }
    setBox({ top: active.offsetTop + 6, height: active.offsetHeight - 12 });
    // Positions depend on layout, not props; callers pass what changes layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return box;
}

export function SancakRail({
  box,
}: Readonly<{ box: SancakRailBox | null }>): React.ReactElement | null {
  if (!box) return null;
  return (
    <span
      aria-hidden
      className="absolute left-0 z-10 w-0.5 rounded-full bg-signature transition-[transform,height] duration-150 ease-[var(--ease-out)]"
      style={{ height: box.height, transform: `translateY(${box.top}px)` }}
    />
  );
}
```

(Under reduced motion the Task 2 rule strips the transform transition — the rail jumps, per spec.)

- [x] **Step 2: Wire into the sidebar nav**

In `app-sidebar.tsx`:

```tsx
const navRef = useRef<HTMLElement | null>(null);
const railBox = useSancakRail(navRef, [pathname, collapsed]);
```

- Give the `<nav>` `ref={navRef}` and add `relative` to its className.
- Render `<SancakRail box={railBox} />` as the nav's first child.
- On the dashboard `<Link>`, add `data-rail-active={dashboardActive || undefined}` and **delete** the per-item static rail `<span>` (the `absolute … bg-signature` element).
- Add `useRef` to the React import.

- [x] **Step 3: Verify**

Run: `pnpm --filter @kurultay/web lint && pnpm --filter @kurultay/web typecheck`
Expected: PASS (the exhaustive-deps disable comment is required for zero warnings). Manual: rail sits beside the active item and repositions when the sidebar collapses.

- [x] **Step 4: Commit**

```bash
git add apps/web/components/layout/sancak-rail.tsx apps/web/components/layout/app-sidebar.tsx
git commit -m "feat(web): sliding sancak rail for the sidebar nav"
```

### Task 11: Shell loading skeleton

**Files:**

- Modify: `apps/web/components/layout/app-shell.tsx:21-27`

- [x] **Step 1: Replace the centered text**

Replace the loading branch with a skeleton that matches the final layout (sidebar strip + topbar + card grid), keeping the string for screen readers:

```tsx
if (sessionPending || !hasSession || !bootstrapped) {
  return (
    <div className="flex min-h-screen bg-background" aria-busy>
      <p className="sr-only">{t('shell.loading')}</p>
      <div className="hidden w-[var(--sidebar-width)] shrink-0 flex-col gap-2 border-r border-border bg-card p-3 lg:flex">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="mt-4 h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[var(--topbar-height)] items-center border-b border-border px-3">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
```

Add `import { Skeleton } from '@/components/ui/skeleton';`.

- [x] **Step 2: Verify and commit**

Run: `pnpm --filter @kurultay/web lint && pnpm --filter @kurultay/web typecheck` — expected PASS.

```bash
git add apps/web/components/layout/app-shell.tsx
git commit -m "feat(web): shell loading skeleton matching final layout"
```

### Task 12: Layer 2 gate and PR

**Files:** none (verification only)

- [x] **Step 1: Full verification** — same three commands as Task 6, all PASS.
- [x] **Step 2: Manual pass** — both themes: topbar on dashboard + board, switcher in rail mode, rail slide, shell skeleton (throttle network to see it).
- [x] **Step 3: PR**

```bash
git push -u origin feat/shell-chrome
gh pr create --base feat/design-primitives --title "feat: shell chrome (topbar, workspace switcher, sancak rail)" --body "$(cat <<'EOF'
Layer 2 of docs/archive/specs/2026-08-09-visual-debt-design.md: shared topbar, workspace switcher dropdown (works from the collapsed rail), sliding sancak rail, shell loading skeleton. Retarget to develop once Layer 1 merges.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Layer 3 — auth screens (branch `feat/auth-visual` from `feat/shell-chrome`)

### Task 13: AuthFormField on ui primitives

**Files:**

- Modify: `apps/web/components/auth/auth-form-field.tsx`

**Interfaces:**

- Produces: same props as today (`label, type?, value, onChange, autoComplete?, required?, minLength?`) — call sites in login/register need no changes.

- [x] **Step 1: Rewrite on Input + Label**

```tsx
'use client';

import { useId } from 'react';
import type { ChangeEventHandler, HTMLInputTypeAttribute } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AuthFormField({
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  required = true,
  minLength,
}: Readonly<{
  label: string;
  type?: HTMLInputTypeAttribute;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
}>): React.ReactElement {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
```

- [x] **Step 2: Verify and commit**

Run: `pnpm --filter @kurultay/web lint && pnpm --filter @kurultay/web typecheck` — expected PASS.

```bash
git checkout -b feat/auth-visual
git add apps/web/components/auth/auth-form-field.tsx
git commit -m "refactor(web): AuthFormField on ui Input and Label"
```

### Task 14: Auth identity treatment

**Files:**

- Create: `apps/web/app/(auth)/layout.tsx`
- Modify: `apps/web/app/(auth)/login/page.tsx`, `apps/web/app/(auth)/register/page.tsx`, `apps/web/app/(auth)/invite/[invitationId]/page.tsx`, `apps/web/app/(app)/workspaces/new/page.tsx`

**Interfaces:**

- Consumes: `DamgaMark` (Task 3), `Button` variants, type-scale utilities (Task 1).

- [x] **Step 1: Shared auth frame**

Create `apps/web/app/(auth)/layout.tsx`:

```tsx
import { DamgaMark } from '@/components/brand/damga-mark';

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <DamgaMark size={64} />
      {children}
    </main>
  );
}
```

- [x] **Step 2: Login page**

In `login/page.tsx`, the page returns a fragment (the layout owns `<main>`):

```tsx
return (
  <>
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-display tracking-tight">{t('title')}</h1>
      <p className="text-body text-muted-foreground">{t('subtitle')}</p>
    </div>

    <form className="flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)}>
      <AuthFormField
        label={t('email')}
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <AuthFormField
        label={t('password')}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error ? <p className="text-body text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {t('submit')}
      </Button>
    </form>

    <p className="text-body text-muted-foreground">
      {t('noAccount')}{' '}
      <Link href="/register" className="text-signature underline underline-offset-4">
        {t('registerLink')}
      </Link>
    </p>
  </>
);
```

Add `import { Button } from '@/components/ui/button';`. Logic (state, `onSubmit`) is unchanged.

- [x] **Step 3: Register page**

Same transformation as Step 2 applied to `register/page.tsx`: fragment root, `font-display text-display tracking-tight` `h1`, `text-body text-muted-foreground` subtitle and footer, `text-body text-destructive` error, submit as `<Button type="submit" disabled={pending}>{t('submit')}</Button>`, footer link classes `text-signature underline underline-offset-4`. The three `AuthFormField`s and all logic stay as-is.

- [x] **Step 4: Invite page**

In `invite/[invitationId]/page.tsx`, all three returns become fragments (layout owns the frame):

- Loading: `<p className="text-body text-muted-foreground">{t('loading')}</p>`
- Signed-out: `h1` and subtitle as in Step 2; the sign-in link becomes
  `<Button asChild><Link href={`/login?next=/invite/${invitationId}`}>{t('signInCta')}</Link></Button>`
- Signed-in: `h1`/subtitle as above, error `text-body text-destructive`, accept button
  `<Button type="button" disabled={pending || !workspaceId} onClick={() => void onAccept()}>{t('submit')}</Button>`

Add the `Button` import; remove every `text-[var(--color-…)]` and `bg-[var(--color-…)]` class from this file.

- [x] **Step 5: Workspace create form**

`app/(app)/workspaces/new/page.tsx` carries the same non-token styling (raw `<label>`/`<input>`/`<button>`, `text-red-600`, `text-[var(--color-…)]`). It renders inside the app shell, so it gets **no** Fraunces or damga — only the primitive swap:

- Replace both `<label>…<input …/></label>` blocks with `AuthFormField` (import from `@/components/auth/auth-form-field`), keeping the exact `value`/`onChange` logic (including the slugify auto-fill and `slugTouched` behavior) by passing the existing handlers through:

```tsx
<AuthFormField
  label={t('name')}
  value={name}
  onChange={(e) => {
    const next = e.target.value;
    setName(next);
    if (!slugTouched) {
      setSlug(slugify(next));
    }
  }}
/>
<AuthFormField
  label={t('slug')}
  value={slug}
  onChange={(e) => {
    setSlugTouched(true);
    setSlug(e.target.value);
  }}
/>
```

- `h1` className becomes `text-title-lg tracking-tight`; subtitle `text-body text-muted-foreground`; error `text-body text-destructive`.
- The raw submit `<button>` becomes `<Button type="submit" disabled={pending}>{t('submit')}</Button>` (import `Button`).

- [x] **Step 6: Verify**

```bash
pnpm --filter @kurultay/web lint && pnpm --filter @kurultay/web typecheck && \
grep -rnE "text-red-|text-\[var\(|bg-\[var\(--color" "apps/web/app/(auth)" apps/web/components/auth "apps/web/app/(app)/workspaces"
```

Expected: lint/typecheck PASS; grep finds nothing.

- [x] **Step 7: Commit**

```bash
git add "apps/web/app/(auth)" apps/web/components/auth "apps/web/app/(app)/workspaces/new/page.tsx"
git commit -m "feat(web): auth and workspace forms on the identity system"
```

### Task 15: Layer 3 gate and PR

**Files:** none (verification only)

- [x] **Step 1: Build** — `pnpm --filter @kurultay/web build`, PASS.
- [x] **Step 2: Manual pass** — login, register, invite in both themes; keyboard-only submit; exactly one copper element per screen (the primary button; the damga and the footer link are the sanctioned exceptions per design.md §2).
- [x] **Step 3: PR**

```bash
git push -u origin feat/auth-visual
gh pr create --base feat/shell-chrome --title "feat: auth screens on the identity system" --body "$(cat <<'EOF'
Layer 3 of docs/archive/specs/2026-08-09-visual-debt-design.md: Fraunces display headline + damga mark via a shared (auth) layout, ui/input + ui/label + ui/button, all non-token colors removed. Retarget to develop once Layer 2 merges.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Layer 4 — board polish (branch `feat/board-polish` from `feat/auth-visual`)

### Task 16: Column stagger on first paint

**Files:**

- Modify: `apps/web/app/globals.css`, `apps/web/components/board/board-view.tsx`, `apps/web/components/board/board-column.tsx`

**Interfaces:**

- Produces: `BoardColumn` accepts optional `className?: string` and `style?: React.CSSProperties`, merged onto its root `<section>`.

- [x] **Step 1: Keyframes**

At the end of `globals.css` add:

```css
@keyframes board-column-enter {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes board-column-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.board-column-enter {
  animation: board-column-enter 200ms var(--ease-out) both;
  animation-delay: calc(var(--stagger-index) * 40ms);
}

@media (prefers-reduced-motion: reduce) {
  .board-column-enter {
    animation-name: board-column-fade;
    animation-delay: 0ms;
  }
}
```

- [x] **Step 2: BoardColumn accepts className/style**

In `board-column.tsx`, add to the props interface:

```tsx
className?: string;
style?: React.CSSProperties;
```

and on the root `<section>`: `className={cn('flex w-[var(--column-width)] … bg-muted/60', className)}` with `style={style}` (add the `cn` import).

- [x] **Step 3: Gate to first paint in BoardView**

In `board-view.tsx`:

```tsx
const [entranceDone, setEntranceDone] = useState(false);

useEffect(() => {
  if (loading || entranceDone) return;
  const timeout = window.setTimeout(() => setEntranceDone(true), columns.length * 40 + 250);
  return () => window.clearTimeout(timeout);
}, [loading, entranceDone, columns.length]);
```

and on each `<BoardColumn>`:

```tsx
className={entranceDone ? undefined : 'board-column-enter'}
style={entranceDone ? undefined : ({ '--stagger-index': index } as React.CSSProperties)}
```

Columns created after the first paint mount with `entranceDone === true` and get no animation — this is the view's one orchestrated moment (design.md §5).

- [x] **Step 4: Verify and commit**

Run: `pnpm --filter @kurultay/web lint && pnpm --filter @kurultay/web typecheck` — expected PASS. Manual: columns cascade in once on load; adding a column later does not re-animate.

```bash
git checkout -b feat/board-polish
git add apps/web/app/globals.css apps/web/components/board/board-view.tsx apps/web/components/board/board-column.tsx
git commit -m "feat(web): stagger columns on first board paint"
```

### Task 17: Board-list card hover, focus, skeleton fidelity

**Files:**

- Modify: `apps/web/components/board/board-list.tsx:85-93,125-138`

- [x] **Step 1: Card hover and focus**

On the `<li>` (line 127–130) extend the className:

```tsx
className =
  'group relative rounded-[var(--radius-lg)] border border-border bg-card p-4 transition-colors hover:border-border-strong hover:bg-muted/40 focus-within:border-border-strong';
```

(The global `:focus-visible` ring already covers keyboard focus on the inner link; `transition-colors` reduces to nothing under reduced motion via Task 2 — color transitions are the kept kind, so it simply stays.)

- [x] **Step 2: Skeleton fidelity**

Replace the loading grid's `<Skeleton className="h-24 w-full" />` with `<Skeleton className="h-[88px] w-full rounded-[var(--radius-lg)]" />` — real card height and radius.

- [x] **Step 3: Verify and commit**

Run: `pnpm --filter @kurultay/web lint` — expected PASS.

```bash
git add apps/web/components/board/board-list.tsx
git commit -m "feat(web): board card hover and focus states, truer skeletons"
```

### Task 18: Action errors become toasts with retry

**Files:**

- Modify: `apps/web/components/board/board-view.tsx`, `apps/web/messages/en.json` (`app.board.column`)

**Interfaces:**

- Consumes: `toast` from `'sonner'` (Task 4).

- [x] **Step 1: Add the retry string**

In `en.json` under `app.board.column`, add: `"retryAction": "Try again"`.

- [x] **Step 2: Replace inline action errors**

In `board-view.tsx`:

- Delete the `actionError` state, its `setActionError` calls, and the `{actionError ? <p …>…</p> : null}` block.
- Add `import { toast } from 'sonner';`.
- In `moveColumn`'s catch:

```tsx
} catch (caught) {
  if (caught instanceof ApiError && caught.statusCode === 403) {
    toast.error(t('errors.forbiddenColumns'));
  } else {
    toast.error(t('column.moveError'), {
      action: {
        label: t('column.retryAction'),
        onClick: () => void moveColumn(column, direction),
      },
    });
  }
}
```

- In `seedDefaults`'s catch, same shape: `403` → plain `toast.error(t('errors.forbiddenColumns'))` (permissions do not change on retry); otherwise `toast.error(t('column.defaultsError'), { action: { label: t('column.retryAction'), onClick: () => void seedDefaults() } })`.

- [x] **Step 3: Verify**

Run: `pnpm --filter @kurultay/web lint && pnpm --filter @kurultay/web typecheck`
Expected: PASS, no unused-variable warnings from the removed state.

- [x] **Step 4: Commit**

```bash
git add apps/web/components/board/board-view.tsx apps/web/messages/en.json
git commit -m "feat(web): surface column action failures as toasts with retry"
```

### Task 19: Final gate and PR

**Files:** none (verification only)

- [x] **Step 1: Full verification**

```bash
pnpm --filter @kurultay/web lint && pnpm --filter @kurultay/web typecheck && pnpm --filter @kurultay/web build
```

Expected: all PASS.

- [x] **Step 2: Repo-wide grep gate (now must be clean everywhere)**

```bash
grep -rnE "text-(red|green|blue|yellow|orange|gray|slate|zinc)-[0-9]|-\[var\(--color" apps/web/components apps/web/app --include='*.tsx'
```

Expected: no matches.

- [x] **Step 3: Manual pass** — both themes: stagger, card hover, toast with working retry (kill the API to trigger one), keyboard tour of dashboard + board.

- [x] **Step 4: PR**

```bash
git push -u origin feat/board-polish
gh pr create --base feat/auth-visual --title "feat: board polish (stagger, card states, toast errors)" --body "$(cat <<'EOF'
Layer 4 of docs/archive/specs/2026-08-09-visual-debt-design.md: first-paint column stagger, board card hover/focus, action errors as toasts with retry. Retarget to develop once Layer 3 merges.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
