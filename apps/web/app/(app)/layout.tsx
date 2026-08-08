import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): Promise<React.ReactElement> {
  const t = await getTranslations();

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <p className="mb-6 text-sm font-semibold">{t('app.shell.title')}</p>
        <nav className="flex flex-col gap-2 text-sm">
          <Link href="/dashboard">{t('app.dashboard.title')}</Link>
        </nav>
      </aside>
      <div className="flex-1 p-6">{children}</div>
    </div>
  );
}
