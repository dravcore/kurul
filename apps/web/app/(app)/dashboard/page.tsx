'use client';

import { useTranslations } from 'next-intl';
import { BoardList } from '@/components/board/board-list';
import { Topbar } from '@/components/layout/topbar';

export default function DashboardPage(): React.ReactElement {
  const t = useTranslations('app.dashboard');
  return (
    <>
      <Topbar title={t('title')} />
      <div className="flex-1 overflow-y-auto p-6">
        <BoardList />
      </div>
    </>
  );
}
