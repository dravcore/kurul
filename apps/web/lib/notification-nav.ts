import type { TaskDto } from '@kurul/shared-types';
import { api } from '@/lib/api';

export async function resolveBoardIdForNotification(
  workspaceId: string,
  taskId: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const fromPayload = payload.boardId;
  if (typeof fromPayload === 'string' && fromPayload.length > 0) {
    return fromPayload;
  }
  try {
    const task = await api.get<TaskDto>(`/workspaces/${workspaceId}/tasks/${taskId}`);
    return task.boardId;
  } catch {
    return null;
  }
}
