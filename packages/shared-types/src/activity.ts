/**
 * Activity `type` string constants — additive payloads, no enum migration.
 *
 * The feed started life as the *task* history, so the list opens with the names that describe
 * something happening to a card and continues with workspace structure and access. That order
 * is readability, **not** membership: which of these an incident responder gets back is decided
 * by `AUDIT_ACTIVITY_TYPES` below and by the rule written above it, never by where a constant
 * sits in this object. An earlier version of this comment counted ("the first seven…"), which
 * stopped being true the moment a card event was added that is not in the audit subset —
 * `attachment.created` is exactly that event, and it is why the rule is now stated rather than
 * implied (docs/decisions/0024-attachment-kinds-and-serving-policy.md).
 *
 * Both kinds share one table on purpose — `Activity` is already tenant-scoped, append-only and
 * indexed on `(workspaceId, type, createdAt)`, so a separate "audit log" table would have
 * duplicated every one of those properties in order to answer the same question through a
 * different join.
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
  // `added`/`removed` rather than `attached`/`detached`: the join row itself is created and
  // deleted, and every other pair on a task's own join tables (`task.assigned`/`unassigned`)
  // already names the join, not the click. The payload is a snapshot (`labelId`, `name`,
  // `color`) rather than only an id, because a label can be renamed or recolored after the row
  // is written and the sentence should describe what happened at the time, not what the label
  // looks like now.
  TaskLabelAdded: 'task.label_added',
  TaskLabelRemoved: 'task.label_removed',
  CommentCreated: 'comment.created',
  // `created`/`deleted` rather than `added`/`removed`: at the time this pair was named, no name
  // in this object used `added`, and `comment.created` / `task.deleted` were the direct
  // precedents. (`task.label_added`/`removed` above came later, naming a join row rather than an
  // upload, and does not reopen this choice.) The names are unrenameable once a row carries one,
  // so matching the existing vocabulary was a one-time free choice (ADR 0024). Only the second of
  // the two joins the audit subset (see the rule below).
  AttachmentCreated: 'attachment.created',
  AttachmentDeleted: 'attachment.deleted',

  // Board structure. Deleting a board cascades its columns, tasks and comments away, so these
  // rows are often the only surviving evidence that the work existed at all.
  BoardCreated: 'board.created',
  BoardUpdated: 'board.updated',
  BoardDeleted: 'board.deleted',
  // One row for an entire imported board, not one per created card. A 500-card import writing
  // 500 `task.created` rows would be the same volume problem `comment.created` is kept out of
  // the audit subset for (ADR 0024) — except here the rows would have no reader at all: the
  // board did not exist a second earlier, so there is no "what changed" question to answer.
  // The counts ride in the payload instead, which is also what lets this type join the audit
  // subset below without reopening that volume argument (ADR 0025).
  BoardImported: 'board.imported',
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
  // Written into every workspace the departing account was a member of, at the moment their
  // membership is removed and their `User` row is anonymised. `userId` is the departing user,
  // never the instance administrator who may have ordered it: an operator's identity must not
  // appear in a tenant's feed, and the administrator half of the record goes to the JSON log
  // instead. The payload carries `targetUserId`, `previousRole` and `initiatedBy` and
  // deliberately no name — a row written to stop naming somebody must not name them
  // (docs/decisions/0026-account-deletion-anonymisation.md).
  //
  // Not written for a workspace the same request deletes: `Activity` cascades on `workspaceId`,
  // so that row would be removed by the statement it describes — the same reason there is no
  // `workspace.deleted` type.
  AccountDeleted: 'account.deleted',
  // Personal access tokens (docs/api-conventions.md, "Authentication"). A token is a standing
  // credential for this workspace, so minting and revoking one are access-changing events in
  // the same sense as an invitation. The payload carries the token's id, name and display
  // prefix and never the secret, which the server does not hold after creation anyway.
  TokenCreated: 'token.created',
  TokenRevoked: 'token.revoked',
} as const;

export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];

/**
 * The subset an incident responder reads: "who removed, granted, reconfigured or destroyed
 * something here?"
 *
 * Exported as one list so that question stays a single query —
 * `WHERE "workspaceId" = $1 AND type = ANY($2) ORDER BY id DESC`, which the existing
 * `(workspaceId, type, createdAt)` index already serves — instead of a set of type strings
 * copy-pasted into whichever tool happens to be asking.
 *
 * ## The membership rule
 *
 * An event belongs here when it is **low-volume** *and* falls into one of three kinds. The
 * volume gate is not a tiebreaker, it is the first condition: a type that any member emits
 * dozens of times a day buries the other kinds in the same query, and no filter downstream can
 * unbury them.
 *
 * 1. **Destructive** — it removes work rather than editing it, so the row is the only thing
 *    left describing what was there. `task.deleted`, `board.deleted`, `column.deleted`,
 *    `label.deleted`, `attachment.deleted`.
 * 2. **Access-changing** — it changes who can reach this workspace. `member.removed`,
 *    `member.left`, `member.role_changed`, `invitation.created`, `invitation.revoked`,
 *    `invitation.accepted`, `token.created`, `token.revoked`.
 * 3. **Structural administration** — it changes the workspace's own shape and vocabulary
 *    rather than the work inside it, and those rows outlive the objects they describe (an
 *    `Activity` row is scoped to the workspace, not to the board, so a `board.created` row is
 *    still there after the board is gone). `board.created`, `board.updated`, `column.created`,
 *    `column.updated`, `label.created`, `label.updated`, `workspace.updated`.
 *
 *    `workspace.updated` sits in this kind because of what it carries today — name, slug,
 *    metadata. **Trigger for moving it to kind 2:** the first workspace setting that decides
 *    who may join or what a member may do (open sign-up, an email-domain allowlist, a default
 *    role). On that day it is access-changing, and this paragraph is wrong rather than merely
 *    incomplete.
 *
 * The third kind is stated because seven of the entries below are in neither of the first two,
 * and a rule that does not describe eighteen of eighteen members is a rule the next person
 * cannot apply. It is also what the older comment beside the board entries was reaching for
 * when it said those rows "are often the only surviving evidence that the work existed at all".
 *
 * ## What that rule excludes, and why it has to
 *
 * Everything that is *content*: task creation, edits, moves, assignments, comments — and
 * `attachment.created`. Those are what members do all day, they change nobody's access, and
 * they configure nothing.
 *
 * `attachment.created` is the one worth spelling out, because the argument for including it is
 * real: an incident responder asking "what did this compromised account do here" wants what was
 * put there as well as what was taken. It stays out anyway. P3-3's Trello importer creates one
 * attachment record per imported URL, so a single board import writes these rows in bulk through
 * a path no rate limit governs — precisely the volume behaviour `comment.created` is excluded
 * for. The upload is still on the task's own activity feed, and `Attachment.uploadedById` still
 * answers "who uploaded this" for a file that exists; what there deliberately is not, is a
 * workspace-wide "everything ever uploaded here" query (ADR 0024).
 *
 * `attachment.deleted` is in, under kind 1, and on the path it covers it is the *stronger* case
 * than `task.deleted`: a deleted task's rows are still in last night's dump, while a deleted
 * attachment's bytes are on a disk the dump does not cover and the nightly orphan sweep removes
 * them once the grace period passes. After that the activity row is the only evidence the file
 * ever existed. It records the singular path only — one user detaching one file — because a
 * workspace, board or task deletion cascades inside Postgres with no application code running
 * to write anything (ADR 0022); that is answered by `task.deleted`/`board.deleted` plus the
 * sweep's counts, not by thousands of rows describing one click.
 */
export const AUDIT_ACTIVITY_TYPES = [
  ActivityType.TaskDeleted,
  ActivityType.AttachmentDeleted,
  ActivityType.BoardCreated,
  // In, and the reasoning ran the other way round from the first guess. ADR 0024 names P3-3's
  // bulk import as a volume risk, so "the import event stays out" looked right — until the code
  // said otherwise: `board.created` is already in, because the third branch of the rule above is
  // structural administration and creating a board is exactly that. An import is another way of
  // creating a board, so keeping it out would make the same event auditable or not depending on
  // which button produced it. The volume objection does not apply because ADR 0025 writes one
  // row per import, which is the decision this membership depends on: if the importer ever
  // starts writing a row per card, this line has to be revisited before that lands.
  ActivityType.BoardImported,
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
  // Kind 2, access-changing: it is the last thing that ever removes this person's access, and
  // unlike `member.left` it is permanent — the account behind it can never come back. Volume is
  // one row per workspace per deleted account, which is the lowest of anything in this list.
  ActivityType.AccountDeleted,
  // Kind 2, access-changing: a token is a credential that keeps working after the browser
  // session that minted it is gone, so "who created a token here, and who revoked one" is the
  // first question after a leaked secret. Volume is a handful of rows per member, ever.
  ActivityType.TokenCreated,
  ActivityType.TokenRevoked,
] as const;

export type AuditActivityType = (typeof AUDIT_ACTIVITY_TYPES)[number];

export const NotificationType = {
  Assignment: 'assignment',
  Mention: 'mention',
  DueSoon: 'due_soon',
} as const;

export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
