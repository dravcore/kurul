import type { Priority } from '@kurultay/shared-types';
import type { Prisma } from '../generated/prisma';

export const taskInclude = {
  assignees: {
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { id: 'asc' },
  },
  labels: {
    include: { label: true },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.TaskInclude;

/**
 * A task row as read with `taskInclude`.
 *
 * Spelled out rather than derived from `Prisma.TaskGetPayload` so unit tests can build a
 * row without the client's generated payload types. `label.color` stays `string` here —
 * this is the database shape, and narrowing it to a slot is the mapper's job.
 */
export type TaskWithRelations = {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: Priority;
  position: number;
  dueDate: Date | null;
  estimatedMinutes: number | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  assignees: Array<{
    user: { id: string; name: string; avatarUrl: string | null };
  }>;
  labels: Array<{
    label: { id: string; boardId: string; name: string; color: string };
  }>;
};
