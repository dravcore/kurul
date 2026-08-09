import { getTranslations } from 'next-intl/server';
import { Topbar } from '@/components/layout/topbar';
import { NotificationsList } from '@/components/notification/notifications-list';

export default async function NotificationsPage(): Promise<React.ReactElement> {
  const t = await getTranslations('app.notifications');

  return (
    <>
      <Topbar title={t('pageTitle')} />
      <div className="flex-1 overflow-y-auto p-6">
        <NotificationsList />
      </div>
    </>
  );
}
