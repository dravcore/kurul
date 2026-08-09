/**
 * Activity `type` string constants — additive payloads, no enum migration.
 */
export const ActivityType = {
  TaskCreated: 'task.created',
  TaskUpdated: 'task.updated',
  TaskMoved: 'task.moved',
  TaskDeleted: 'task.deleted',
  TaskAssigned: 'task.assigned',
  TaskUnassigned: 'task.unassigned',
  CommentCreated: 'comment.created',
} as const;

export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];

export const NotificationType = {
  Assignment: 'assignment',
  Mention: 'mention',
  DueSoon: 'due_soon',
} as const;

export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
