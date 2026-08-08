// Manually mirrors the `Priority` enum in apps/api/prisma/schema.prisma.
// The Prisma schema is the source of truth — if you change one, change both.
export const Priority = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;

export type Priority = (typeof Priority)[keyof typeof Priority];

// Manually mirrors the `MemberRole` enum in apps/api/prisma/schema.prisma.
// The Prisma schema is the source of truth — if you change one, change both.
export const MemberRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
  GUEST: 'GUEST',
} as const;

export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];
