// Manually mirrors the `Priority` enum in apps/api/prisma/schema.prisma.
// Product enums live here; keep Prisma schema in sync.
export const Priority = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;

export type Priority = (typeof Priority)[keyof typeof Priority];

// Manually mirrors the `MemberRole` enum in apps/api/prisma/schema.prisma.
export const MemberRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
  GUEST: 'GUEST',
} as const;

export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];

/**
 * Manually mirrors the `ColumnCategory` enum in apps/api/prisma/schema.prisma.
 *
 * What a column *means*, held apart from what it is called. Completion metrics read this and
 * never `Column.name`, so renaming "Done" to "Shipped" — or seeding a board's columns in the
 * creator's language — cannot silently zero a dashboard.
 *
 * Only `COMPLETED` has a consumer today. The rest is deliberate vocabulary: `CANCELED` ships
 * unused because a canceled task is neither finished work nor open work, and discovering that
 * after choosing a boolean costs a second migration and a second backfill.
 *
 * See docs/decisions/0019-column-category.md.
 */
export const ColumnCategory = {
  BACKLOG: 'BACKLOG',
  UNSTARTED: 'UNSTARTED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED',
} as const;

export type ColumnCategory = (typeof ColumnCategory)[keyof typeof ColumnCategory];

/** Better Auth / Nest invitation lifecycle statuses. */
export const InvitationStatus = {
  pending: 'pending',
  accepted: 'accepted',
  canceled: 'canceled',
  rejected: 'rejected',
} as const;

export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];

/**
 * What became of one outbound email, as observed while the request that triggered it ran.
 *
 * Not a stored column and not a delivery receipt: SMTP only tells the sender that a relay
 * accepted the message, never that it reached an inbox. The distinction this enum actually
 * carries is the one the product was silent about — whether the deployment even has a
 * transport that could deliver anything (`docs/decisions/0013-invitation-email-verification.md`
 * makes an unaccepted invitation the consequence of a missing one).
 *
 * `NOT_CONFIGURED` is therefore the important value, and it is a *fact*, not a guess: the log
 * transport reports it from the send it just swallowed.
 */
export const MailDeliveryStatus = {
  /** A transport accepted the message. Says nothing about what the recipient's server did. */
  SENT: 'SENT',
  /** No SMTP host is configured, so the message was written to the API log and delivered nowhere. */
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  /** A transport exists and refused the message. The failure is in the API log with its stack. */
  FAILED: 'FAILED',
} as const;

export type MailDeliveryStatus = (typeof MailDeliveryStatus)[keyof typeof MailDeliveryStatus];

/**
 * Theme-resolved label color slots (`docs/design.md`). Never store raw hex.
 */
export const LabelColorSlot = {
  'slot-1': 'slot-1',
  'slot-2': 'slot-2',
  'slot-3': 'slot-3',
  'slot-4': 'slot-4',
  'slot-5': 'slot-5',
  'slot-6': 'slot-6',
  'slot-7': 'slot-7',
  'slot-8': 'slot-8',
} as const;

export type LabelColorSlot = (typeof LabelColorSlot)[keyof typeof LabelColorSlot];
