import { getTranslations } from 'next-intl/server';

export default async function DashboardPage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">{t('app.dashboard.title')}</h1>
      <p className="text-sm text-[var(--color-muted-foreground)]">{t('app.dashboard.placeholder')}</p>
    </section>
  );
}
