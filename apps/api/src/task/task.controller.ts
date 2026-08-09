import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import type { TaskDto } from '@kurultay/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { ParseUuidV7Pipe } from '../common/pipes/parse-uuid-v7.pipe';
import type { AuthenticatedUser } from '../common/types/request-context';
import { CreateTaskDto } from './dto/create-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
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
  @UseGuards(WorkspaceGuard)
  list(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('boardId', ParseUuidV7Pipe) boardId: string,
  ): Promise<TaskDto[]> {
    return this.taskService.list(workspaceId, boardId);
  }

  @Post('boards/:boardId/tasks')
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MEMBER)
  create(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('boardId', ParseUuidV7Pipe) boardId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTaskDto,
  ): Promise<TaskDto> {
    return this.taskService.create(workspaceId, boardId, user.id, dto);
  }

  @Get('tasks/:taskId')
  @UseGuards(WorkspaceGuard)
  get(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('taskId', ParseUuidV7Pipe) taskId: string,
  ): Promise<TaskDto> {
    return this.taskService.get(workspaceId, taskId);
  }

  @Patch('tasks/:taskId')
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MEMBER)
  update(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('taskId', ParseUuidV7Pipe) taskId: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskDto> {
    return this.taskService.update(workspaceId, taskId, dto);
  }

  @Delete('tasks/:taskId')
  @HttpCode(204)
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MEMBER)
  async remove(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('taskId', ParseUuidV7Pipe) taskId: string,
  ): Promise<void> {
    await this.taskService.remove(workspaceId, taskId);
  }

  @Patch('tasks/:taskId/position')
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MEMBER)
  move(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('taskId', ParseUuidV7Pipe) taskId: string,
    @Body() dto: MoveTaskDto,
  ): Promise<TaskDto> {
    return this.taskService.move(workspaceId, taskId, dto);
  }
}
