import { MobileNav } from './mobile-nav';

/**
 * The 48px bar at the top of every signed-in page — 56px below `md`, where it also carries the
 * only way into navigation.
 *
 * `MobileNav` is rendered here, unconditionally, rather than passed in as `leading` by each of
 * the four callers: the hamburger is not one page's decision, and a page that forgot to pass
 * it would be a page with no navigation at all on a phone. It renders `md:hidden`, so above
 * the breakpoint this costs the bar nothing.
 *
 * `gap-2` below `md` and `gap-3` above: with three 44px controls and a title in 360px, 4px per
 * gap is 12px of title.
 */
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
    <header className="sticky top-0 z-20 flex h-[var(--topbar-height)] shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur-sm md:gap-3">
      <MobileNav />
      {leading}
      <h1 className="min-w-0 flex-1 truncate text-title">{title}</h1>
      {actions}
    </header>
  );
}
