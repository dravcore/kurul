import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import type { CursorPage, TaskDto } from '@kurultay/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import {
  CONTENT_ROLES,
  WorkspaceRoles,
  WorkspaceScoped,
} from '../common/decorators/workspace-roles.decorator';
import type { AuthenticatedUser } from '../common/types/request-context';
import { AddAssigneeDto } from './dto/add-assignee.dto';
import { AddTaskLabelDto } from './dto/add-task-label.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { TaskQueryDto } from './dto/task-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskService } from './task.service';

/**
 * Nested under workspace for tenant scoping. List/create hang off the board;
 * get/update/delete/position address the task id shallowly (api-conventions).
 */
@Controller('workspaces/:workspaceId')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get('boards/:boardId/tasks')
  @WorkspaceScoped()
  list(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('boardId') boardId: string,
    @Query() query: TaskQueryDto,
  ): Promise<CursorPage<TaskDto>> {
    return this.taskService.list(workspaceId, boardId, query);
  }

  @Post('boards/:boardId/tasks')
  @WorkspaceRoles(...CONTENT_ROLES)
  create(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('boardId') boardId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTaskDto,
  ): Promise<TaskDto> {
    return this.taskService.create(workspaceId, boardId, user.id, dto);
  }

  @Get('tasks/:taskId')
  @WorkspaceScoped()
  get(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
  ): Promise<TaskDto> {
    return this.taskService.get(workspaceId, taskId);
  }

  @Patch('tasks/:taskId')
  @WorkspaceRoles(...CONTENT_ROLES)
  update(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskDto> {
    return this.taskService.update(workspaceId, taskId, user.id, dto);
  }

  @Delete('tasks/:taskId')
  @HttpCode(204)
  @WorkspaceRoles(...CONTENT_ROLES)
  async remove(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.taskService.remove(workspaceId, taskId, user.id);
  }

  @Patch('tasks/:taskId/position')
  @WorkspaceRoles(...CONTENT_ROLES)
  move(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MoveTaskDto,
  ): Promise<TaskDto> {
    return this.taskService.move(workspaceId, taskId, user.id, dto);
  }

  @Post('tasks/:taskId/assignees')
  @WorkspaceRoles(...CONTENT_ROLES)
  addAssignee(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddAssigneeDto,
  ): Promise<TaskDto> {
    return this.taskService.addAssignee(workspaceId, taskId, user.id, dto);
  }

  @Delete('tasks/:taskId/assignees/:userId')
  @WorkspaceRoles(...CONTENT_ROLES)
  removeAssignee(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @UuidParam('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TaskDto> {
    return this.taskService.removeAssignee(workspaceId, taskId, user.id, userId);
  }

  @Post('tasks/:taskId/labels')
  @WorkspaceRoles(...CONTENT_ROLES)
  addLabel(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddTaskLabelDto,
  ): Promise<TaskDto> {
    return this.taskService.addLabel(workspaceId, taskId, user.id, dto);
  }

  @Delete('tasks/:taskId/labels/:labelId')
  @WorkspaceRoles(...CONTENT_ROLES)
  removeLabel(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @UuidParam('labelId') labelId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TaskDto> {
    return this.taskService.removeLabel(workspaceId, taskId, user.id, labelId);
  }
}
