'use client';

import { useTranslations } from 'next-intl';
import { AppSidebar } from './app-sidebar';
import { DemoBanner } from './demo-banner';
import { useWorkspaceContext, WorkspaceProvider } from './workspace-provider';
import { NotificationUnreadProvider } from '@/components/notification/notification-unread-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

function AppShellFrame({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  const t = useTranslations('app');
  const { workspaces, sessionPending, hasSession, bootstrapped, loadError, retryBootstrap } =
    useWorkspaceContext();

  if (sessionPending || !hasSession || !bootstrapped) {
    return (
      <div className="flex h-dvh overflow-hidden bg-background" aria-busy>
        <p className="sr-only">{t('shell.loading')}</p>
        {/* `md:flex`, matching `AppSidebar`: the skeleton used to appear only from `lg` up, so
            between 768px and 1024px the shell painted with no sidebar and then grew one.

            `workspaces` is the last bootstrap's roster, which a plain reload keeps standing
            while a fresh one is in flight (`useApiResource` only clears it on failure), so on
            the very first load it is the same empty array as an account with no workspaces.
            Painting this block on that guess is what a first-time signup used to watch flash
            and disappear on its way to `/workspaces/new`, whose own layout carries no sidebar
            at all: skip the shape until a roster is actually known to be there. */}
        {workspaces.length > 0 ? (
          <div className="hidden w-[var(--sidebar-width)] shrink-0 flex-col gap-2 border-r border-border bg-card p-3 md:flex">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="mt-4 h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : null}
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

  if (loadError) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-body text-destructive">{loadError}</p>
        <Button type="button" onClick={retryBootstrap}>
          {t('shell.retry')}
        </Button>
      </div>
    );
  }

  return (
    /**
     * `h-dvh overflow-hidden`, not `min-h-screen` — this is the fix for issue #184.
     *
     * `min-h-screen` says "at least the viewport" and puts no ceiling on anything below it.
     * With nothing bounded, a column's `overflow-y-auto` had nothing to clip against and never
     * scrolled: the *document* grew instead. Measured on a board seeded with 1 000 tasks, the
     * document reached 27 425px and the reader scrolled the page past a column header that was
     * `sticky` to a box it had already left. Per-column scrolling — which is most of what makes
     * a Kanban board readable, and what `docs/design.md` §4 says a column is — did not exist.
     *
     * Fixing it here rather than in `components/board/**` is the point: every link in the chain
     * below this one already declares its bound (`main` is `min-h-0`, the board is `h-full
     * min-h-0`, the canvas is `min-h-0 flex-1`, the column's card list is `flex-1
     * overflow-y-auto`). They were all correct and all inert, because the topmost link opted
     * out. One `min-h` was holding the whole chain open.
     *
     * `dvh` and not `vh`: on a phone `100vh` is the viewport with the browser chrome
     * *retracted*, so a `vh`-sized shell is taller than what is on screen and the topbar is
     * pushed under the address bar on first paint.
     *
     * The trade this makes is deliberate: the document no longer scrolls anywhere in the app,
     * so every page owns its own scroll container. The three non-board pages already did
     * (`flex-1 overflow-y-auto` on dashboard, settings and notifications) — they were written
     * for a bounded shell that had not been built yet.
     *
     * `DemoBanner` is the one thing allowed above the sidebar, and it is why this is now a
     * column: the strip takes its natural height (`shrink-0`, and it renders `null` on every
     * instance that is not a demo, which is all of them by default), and the row below it is
     * `min-h-0 flex-1`, which hands the bounded-height chain described above straight through
     * unchanged. Nesting it inside `main` instead would have put it below the sidebar and
     * scrolled it away with the page, which is not what a standing notice is.
     */
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <DemoBanner />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* No workspace, no sidebar. Every link in `SidebarBody` needs one, and
            `workspace-provider.tsx`'s bootstrap effect sends a reader with none straight back to
            `/workspaces/new`, so the whole navigation would be a loop; that route carries its
            own header instead, and this is what keeps it the only chrome on screen rather than
            a second wordmark and a second sign-out beside the sidebar's. */}
        {workspaces.length > 0 ? <AppSidebar /> : null}
        {/* Skip-link target (see app/(app)/layout.tsx): tabIndex={-1} lets the fragment
            navigation move keyboard focus here without adding a tab stop.

            Taking that link is a keyboard action and this element does match `:focus-visible`
            after it, so the landing has to show the one focus mark app/globals.css draws in
            `@layer base`; an `outline-*` suppressor here is the only thing that can erase it.
            The offset is pulled inside instead of left at 2px because this region fills the
            shell and the row above is `overflow-hidden`, which clips an outline drawn outside
            the region away entirely.

            `min-h-0` is what passes the bound on: a flex child's default `min-height: auto`
            refuses to shrink below its content, which would have let the board push `main`
            taller than the shell and re-opened the chain one level down. */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex min-h-0 min-w-0 flex-1 flex-col focus-visible:-outline-offset-2"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export function AppShell({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  return (
    /* The unread count is mounted here, above both surfaces that read it: the bell renders
       inside `AppSidebar` and the notifications page inside `main`, so this is the lowest node
       that contains both. It sits under `WorkspaceProvider` because the count is scoped to the
       active workspace, which is what that provider resolves. */
    <WorkspaceProvider>
      <NotificationUnreadProvider>
        <AppShellFrame>{children}</AppShellFrame>
      </NotificationUnreadProvider>
    </WorkspaceProvider>
  );
}
