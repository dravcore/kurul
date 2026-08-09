import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { BoardList } from '@/components/board/board-list';
import { DashboardSummary } from '@/components/dashboard/dashboard-summary';
import { Topbar } from '@/components/layout/topbar';
import { Skeleton } from '@/components/ui/skeleton';

function SummaryFallback(): React.ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-24 w-full rounded-[var(--radius-lg)]" />
        <Skeleton className="h-24 w-full rounded-[var(--radius-lg)]" />
      </div>
      <Skeleton className="h-56 w-full rounded-[var(--radius-lg)]" />
    </div>
  );
}

export default async function DashboardPage(): Promise<React.ReactElement> {
  const t = await getTranslations('app.dashboard');

  return (
    <>
      <Topbar title={t('title')} />
      <div className="flex-1 space-y-10 overflow-y-auto p-6">
        <Suspense fallback={<SummaryFallback />}>
          <DashboardSummary />
        </Suspense>
        <section className="space-y-3">
          <h2 className="text-title">{t('boardsTitle')}</h2>
          <BoardList />
        </section>
      </div>
    </>
  );
}
