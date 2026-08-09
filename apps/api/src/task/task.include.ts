import type { TaskDto } from '@kurultay/shared-types';

export const taskInclude = {
  assignees: {
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { id: 'asc' as const },
  },
  labels: {
    include: { label: true },
    orderBy: { id: 'asc' as const },
  },
};

export type TaskWithRelations = {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: TaskDto['priority'];
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
