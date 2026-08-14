/**
 * Activity `type` string constants — additive payloads, no enum migration.
 *
 * The feed started life as the *task* history, which is why the first seven names all describe
 * something that happened to a card. The rest of the list is the audit trail: the acts that
 * change who can reach a workspace, or that destroy work outright. Both kinds share one table
 * on purpose — `Activity` is already tenant-scoped, append-only and indexed on
 * `(workspaceId, type, createdAt)`, so a separate "audit log" table would have duplicated every
 * one of those properties in order to answer the same question through a different join.
 *
 * The names are `<subject>.<past-tense verb>` and they are written into the database, so they
 * are a storage format and not display text: renaming one orphans every row already carrying
 * the old string. Add, never rename.
 */
export const ActivityType = {
  TaskCreated: 'task.created',
  TaskUpdated: 'task.updated',
  TaskMoved: 'task.moved',
  TaskDeleted: 'task.deleted',
  TaskAssigned: 'task.assigned',
  TaskUnassigned: 'task.unassigned',
  CommentCreated: 'comment.created',

  // Board structure. Deleting a board cascades its columns, tasks and comments away, so these
  // rows are often the only surviving evidence that the work existed at all.
  BoardCreated: 'board.created',
  BoardUpdated: 'board.updated',
  BoardDeleted: 'board.deleted',
  ColumnCreated: 'column.created',
  ColumnUpdated: 'column.updated',
  ColumnDeleted: 'column.deleted',
  LabelCreated: 'label.created',
  LabelUpdated: 'label.updated',
  LabelDeleted: 'label.deleted',

  // Workspace administration and access. There is deliberately no `workspace.deleted`: every
  // `Activity` row is `onDelete: Cascade` on its workspace, so a row recording that deletion
  // would be removed by the very statement it describes. `WorkspaceService.remove` writes that
  // one event to the application log instead — see the comment there.
  WorkspaceUpdated: 'workspace.updated',
  MemberRemoved: 'member.removed',
  MemberLeft: 'member.left',
  MemberRoleChanged: 'member.role_changed',
  InvitationCreated: 'invitation.created',
  InvitationRevoked: 'invitation.revoked',
  InvitationAccepted: 'invitation.accepted',
} as const;

export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];

/**
 * The subset an incident responder reads: "who removed, granted or destroyed something here?"
 *
 * Exported as one list so that question stays a single query —
 * `WHERE "workspaceId" = $1 AND type = ANY($2) ORDER BY id DESC`, which the existing
 * `(workspaceId, type, createdAt)` index already serves — instead of a set of type strings
 * copy-pasted into whichever tool happens to be asking. Ordinary task edits, moves and comments
 * are excluded: they outnumber everything else here by orders of magnitude and none of them
 * changes anyone's access.
 *
 * `task.deleted` *is* included. It is the one content event that destroys rather than edits,
 * and "who deleted the card" is a question that actually gets asked after an account is
 * compromised.
 */
export const AUDIT_ACTIVITY_TYPES = [
  ActivityType.TaskDeleted,
  ActivityType.BoardCreated,
  ActivityType.BoardUpdated,
  ActivityType.BoardDeleted,
  ActivityType.ColumnCreated,
  ActivityType.ColumnUpdated,
  ActivityType.ColumnDeleted,
  ActivityType.LabelCreated,
  ActivityType.LabelUpdated,
  ActivityType.LabelDeleted,
  ActivityType.WorkspaceUpdated,
  ActivityType.MemberRemoved,
  ActivityType.MemberLeft,
  ActivityType.MemberRoleChanged,
  ActivityType.InvitationCreated,
  ActivityType.InvitationRevoked,
  ActivityType.InvitationAccepted,
] as const;

export type AuditActivityType = (typeof AUDIT_ACTIVITY_TYPES)[number];

export const NotificationType = {
  Assignment: 'assignment',
  Mention: 'mention',
  DueSoon: 'due_soon',
} as const;

export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
