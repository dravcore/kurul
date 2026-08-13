import { getTranslations } from 'next-intl/server';
import { Topbar } from '@/components/layout/topbar';
import { LanguageSettings } from '@/components/settings/language-settings';
import { MembersSettings } from '@/components/settings/members-settings';

/**
 * One section of the settings screen: a heading, one sentence about what it decides, and the
 * control that decides it.
 *
 * Extracted the moment there was a second section. The page is a list of these and nothing
 * else, so a new one (workspace name, outbound mail) is a `<SettingsSection>` and its body,
 * not another copy of the heading markup that the next section would drift away from.
 */
function SettingsSection({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description: string;
  children: React.ReactNode;
}>): React.ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-title font-semibold tracking-tight">{title}</h2>
        <p className="text-body text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default async function SettingsPage(): Promise<React.ReactElement> {
  const t = await getTranslations('app.settings');

  return (
    <>
      <Topbar title={t('title')} />
      {/* 720px: settings are read rather than scanned (docs/design.md §4). */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8">
          {/* Members first: it is the only section that is about other people, and the one a
              new workspace owner is on this screen to find. */}
          <SettingsSection title={t('members.title')} description={t('members.description')}>
            <MembersSettings />
          </SettingsSection>
          <SettingsSection title={t('language.title')} description={t('language.description')}>
            <LanguageSettings />
          </SettingsSection>
        </div>
      </div>
    </>
  );
}
