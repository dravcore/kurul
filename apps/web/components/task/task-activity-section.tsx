'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ActivityDto } from '@kurultay/shared-types';
import { formatActivitySummary } from '@/lib/activity-summary';
import { formatRelativeTime } from '@/lib/relative-time';

interface TaskActivitySectionProps {
  activities: ActivityDto[];
  /** Suppresses the empty message until the first fetch has settled. */
  loading: boolean;
}

/** Read-only history for the task, newest last, as the API returns it. */
export function TaskActivitySection({
  activities,
  loading,
}: TaskActivitySectionProps): React.ReactElement {
  const t = useTranslations('app.board.task.activity');
  const locale = useLocale();

  return (
    <div className="flex flex-col gap-2">
      <p className="text-small font-medium text-foreground">{t('title')}</p>
      <ul className="flex flex-col gap-2">
        {activities.map((activity) => (
          <li key={activity.id} className="rounded-md border border-border px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-small font-medium text-foreground">{activity.author.name}</p>
              <time
                className="shrink-0 text-micro text-muted-foreground"
                dateTime={activity.createdAt}
                title={new Date(activity.createdAt).toISOString()}
              >
                {formatRelativeTime(activity.createdAt, locale)}
              </time>
            </div>
            <p className="mt-1 text-body text-foreground-secondary">
              {formatActivitySummary(activity, t)}
            </p>
          </li>
        ))}
        {activities.length === 0 && !loading ? (
          <li className="text-small text-muted-foreground">{t('empty')}</li>
        ) : null}
      </ul>
    </div>
  );
}
