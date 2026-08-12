import { getTranslations } from 'next-intl/server';
import { Topbar } from '@/components/layout/topbar';
import { LanguageSettings } from '@/components/settings/language-settings';

export default async function SettingsPage(): Promise<React.ReactElement> {
  const t = await getTranslations('app.settings');

  return (
    <>
      <Topbar title={t('title')} />
      {/* 720px: settings are read rather than scanned (docs/design.md §4). */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8">
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-title font-semibold tracking-tight">
                {t('language.title')}
              </h2>
              <p className="text-body text-muted-foreground">{t('language.description')}</p>
            </div>
            <LanguageSettings />
          </section>
        </div>
      </div>
    </>
  );
}
