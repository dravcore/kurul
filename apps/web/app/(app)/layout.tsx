import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/layout/app-shell';

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): Promise<React.ReactElement> {
  const t = await getTranslations('app');

  return (
    <>
      {/* First tab stop on every signed-in page (WCAG 2.4.1): visually hidden until it
          receives keyboard focus, then surfaces above the shell. Target lives on the
          app shell's <main id="main-content">. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-body focus:text-foreground"
      >
        {t('shell.skipToContent')}
      </a>
      <AppShell>{children}</AppShell>
    </>
  );
}
