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
