import { Injectable } from '@nestjs/common';
import { SocketEvents } from '@kurultay/shared-types';
import type { TaskDto } from '@kurultay/shared-types';
import { RealtimeService } from '../realtime/realtime.service';
import { TaskReadService } from './task-read.service';
import { toTaskDto } from './task.mapper';

/**
 * Realtime side effects of a task mutation.
 *
 * This is a provider rather than a helper that takes `RealtimeService` as an argument: a
 * function receiving the service it needs is a service locator, and the layer table in
 * docs/coding-standards.md puts side effects in a service. It lives in the task module
 * rather than on `RealtimeService` because `RealtimeService` is the transport and must not
 * learn the task domain's row shapes — the dependency points task → realtime, never back.
 */
@Injectable()
export class TaskEventsService {
  constructor(
    private readonly taskRead: TaskReadService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Re-reads the task with its relations, announces the change to the board, and returns the
   * DTO the HTTP caller gets back — so the response and the broadcast describe the same
   * post-mutation state, read once.
   */
  async emitUpdated(workspaceId: string, taskId: string, actorId: string): Promise<TaskDto> {
    const dto = toTaskDto(await this.taskRead.findTask(workspaceId, taskId));
    this.realtime.emitToBoard(dto.boardId, SocketEvents.TASK_UPDATED, {
      workspaceId,
      boardId: dto.boardId,
      actorId,
      taskId: dto.id,
    });
    return dto;
  }
}
