import { getTranslations } from 'next-intl/server';
import { Topbar } from '@/components/layout/topbar';
import { DeleteAccountSettings } from '@/components/settings/delete-account-settings';

/**
 * The account-deletion confirmation, out from under `/settings`'s dialog.
 *
 * `deletePageTitle` rather than `title`: `app.settings.account.title` is still what `/settings`
 * shows on the section this route is reached from, and this is a second, separate reading of
 * the same screen (same reasoning as `app.settings.members.pageTitle`).
 */
export default async function DeleteAccountPage(): Promise<React.ReactElement> {
  const t = await getTranslations('app.settings.account');

  return (
    <>
      <Topbar title={t('deletePageTitle')} />
      {/* 720px: the same reading width `/settings` itself uses (docs/design.md §4). */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8">
          <DeleteAccountSettings />
        </div>
      </div>
    </>
  );
}
