import { getTranslations } from 'next-intl/server';
import { Topbar } from '@/components/layout/topbar';
import { MembersSettings } from '@/components/settings/members-settings';

/**
 * The roster on its own route, out from under `/settings`'s list of one-paragraph sections.
 *
 * `pageTitle` rather than `title`: `app.settings.members.title` is still what `/settings`
 * shows on the section it links out from, and this is a second, separate reading of the same
 * screen (same reasoning as `app.notifications.title` vs. `pageTitle`).
 */
export default async function MembersSettingsPage(): Promise<React.ReactElement> {
  const t = await getTranslations('app.settings.members');

  return (
    <>
      <Topbar title={t('pageTitle')} />
      {/* 720px: the same reading width `/settings` itself uses (docs/design.md §4). */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8">
          <MembersSettings />
        </div>
      </div>
    </>
  );
}
