import { getTranslations } from 'next-intl/server';

export default async function RegisterPage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t('auth.register.title')}</h1>
      <p className="text-sm text-[var(--color-muted-foreground)]">{t('auth.register.subtitle')}</p>
    </main>
  );
}
