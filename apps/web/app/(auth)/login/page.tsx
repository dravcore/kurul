import { getTranslations } from 'next-intl/server';

export default async function LoginPage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t('auth.login.title')}</h1>
      <p className="text-sm text-[var(--color-muted-foreground)]">{t('auth.login.subtitle')}</p>
      <button
        type="button"
        className="rounded-[var(--radius-lg)] bg-[var(--color-primary)] px-4 py-2 text-[var(--color-primary-foreground)]"
      >
        {t('auth.login.submit')}
      </button>
    </main>
  );
}
