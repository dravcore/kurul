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

/** Better Auth / Nest invitation lifecycle statuses. */
export const InvitationStatus = {
  pending: 'pending',
  accepted: 'accepted',
  canceled: 'canceled',
  rejected: 'rejected',
} as const;

export type InvitationStatus =
  (typeof InvitationStatus)[keyof typeof InvitationStatus];

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
