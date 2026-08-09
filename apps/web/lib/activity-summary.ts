import { ActivityType, type ActivityDto } from '@kurultay/shared-types';

type Translate = (key: string, values?: Record<string, string | number | Date>) => string;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function changedFields(payload: Record<string, unknown>): string {
  const changes = payload.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return '';
  return Object.keys(changes).join(', ');
}

/** Humanize an activity row using `app.board.task.activity` message keys. */
export function formatActivitySummary(activity: ActivityDto, t: Translate): string {
  const title = asString(activity.payload.title) ?? '';
  switch (activity.type) {
    case ActivityType.TaskCreated:
      return t('types.taskCreated', { title });
    case ActivityType.TaskUpdated: {
      const fields = changedFields(activity.payload);
      return fields.length > 0
        ? t('types.taskUpdatedFields', { title, fields })
        : t('types.taskUpdated', { title });
    }
    case ActivityType.TaskMoved:
      return t('types.taskMoved', { title });
    case ActivityType.TaskDeleted:
      return t('types.taskDeleted', { title });
    case ActivityType.TaskAssigned:
      return t('types.taskAssigned', { title });
    case ActivityType.TaskUnassigned:
      return t('types.taskUnassigned', { title });
    case ActivityType.CommentCreated:
      return t('types.commentCreated', { title });
    default:
      return t('types.unknown', { type: activity.type });
  }
}
