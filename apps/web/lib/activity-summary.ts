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
    case ActivityType.BoardImported: {
      // The only row an import writes, and the only one whose subject is not in `title`: the
      // payload names the board under `name` (ADR 0025). Without this case the row fell through
      // to `types.unknown` and the audit trail read `board.imported` — the wire value, in a list
      // of sentences.
      const name = asString(activity.payload.name) ?? '';
      const skipped = activity.payload.skippedTotal;
      return t('types.boardImported', {
        title: name,
        count: typeof skipped === 'number' ? skipped : 0,
      });
    }
    default:
      return t('types.unknown', { type: activity.type });
  }
}
