import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { CursorPage, TaskDto } from '@kurul/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import {
  CONTENT_ROLES,
  WorkspaceRoles,
  WorkspaceScoped,
} from '../common/decorators/workspace-roles.decorator';
import { ThrottleTaskList } from '../common/rate-limit/rate-limit';
import type { AuthenticatedUser } from '../common/types/request-context';
import { TaskPageSchema, TaskSchema } from '../openapi/schemas/task.schema';
import { ChecklistItemService } from './checklist-item.service';
import { ChecklistService } from './checklist.service';
import { AddAssigneeDto } from './dto/add-assignee.dto';
import { AddTaskLabelDto } from './dto/add-task-label.dto';
import { CreateChecklistItemDto } from './dto/create-checklist-item.dto';
import { CreateChecklistDto } from './dto/create-checklist.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { MoveChecklistItemDto } from './dto/move-checklist-item.dto';
import { MoveChecklistDto } from './dto/move-checklist.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { TaskQueryDto } from './dto/task-query.dto';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto';
import { UpdateChecklistDto } from './dto/update-checklist.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskService } from './task.service';

/**
 * Nested under workspace for tenant scoping. List/create hang off the board;
 * get/update/delete/position address the task id shallowly (api-conventions).
 */
@ApiTags('Tasks')
@Controller('workspaces/:workspaceId')
export class TaskController {
  constructor(
    private readonly taskService: TaskService,
    private readonly checklists: ChecklistService,
    private readonly checklistItems: ChecklistItemService,
  ) {}

  /**
   * Rate limited on a curve: `?q=` runs a trigram scan and gets a tighter ceiling than the
   * board's ordinary paging, which shares this handler — see `taskListRateLimit`.
   */
  @Get('boards/:boardId/tasks')
  @ApiOperation({
    summary: "List a board's tasks",
    description: [
      'A cursor page **walked by `id`, never by `position`** \u2014 fractional indexing rewrites',
      '`position` on every drag, so a cursor keyed on it would never return a row someone moved',
      'past the window again. Sort the accumulated set by `position` for display.',
      '',
      'Filters combine with AND; repeated values within one filter are OR. An unknown query key',
      'is a `400` rather than a silently dropped filter.',
      '',
      '`?q=` runs a trigram scan over title and description and carries a tighter rate limit',
      'than the same route without it.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: TaskPageSchema })
  @ThrottleTaskList()
  @WorkspaceScoped()
  list(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('boardId') boardId: string,
    @Query() query: TaskQueryDto,
  ): Promise<CursorPage<TaskDto>> {
    return this.taskService.list(workspaceId, boardId, query);
  }

  @Post('boards/:boardId/tasks')
  @ApiOperation({ summary: 'Create a task in a board' })
  @ApiCreatedResponse({ type: TaskSchema })
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
  @ApiOperation({
    summary: 'Read one task',
    description:
      'The only read that carries full `checklists`; a list read fills `checklistSummary` and ' +
      'leaves `checklists` `null`.',
  })
  @ApiOkResponse({ type: TaskSchema })
  @WorkspaceScoped()
  get(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
  ): Promise<TaskDto> {
    return this.taskService.get(workspaceId, taskId);
  }

  @Patch('tasks/:taskId')
  @ApiOperation({
    summary: 'Update a task',
    description:
      'Only the fields present change. Sending `null` explicitly clears a nullable field; ' +
      'omitting it leaves the field untouched.',
  })
  @ApiOkResponse({ type: TaskSchema })
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
  @ApiOperation({
    summary: 'Delete a task',
    description: 'Cascades to its comments, checklists and attachments.',
  })
  @ApiNoContentResponse({ description: 'Deleted. Empty body.' })
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
  @ApiOperation({
    summary: 'Move a task',
    description:
      'Column and ordering in one request. The new `position` is a fractional index computed ' +
      'from the neighbours named in the body, so concurrent moves do not have to renumber the ' +
      'column. Moving to a column on another board is `422`.',
  })
  @ApiOkResponse({ type: TaskSchema })
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
  @ApiOperation({
    summary: 'Assign a member to a task',
    description: 'Answers with the whole task, so a client never stitches two responses together.',
  })
  @ApiCreatedResponse({ type: TaskSchema })
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
  @ApiOperation({
    summary: 'Unassign a member',
    description:
      'Answers `200` with the task rather than `204`: the assignment is a sub-resource of the ' +
      'task, and the caller needs the updated task either way.',
  })
  @ApiOkResponse({ type: TaskSchema })
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
  @ApiOperation({ summary: 'Attach a label to a task' })
  @ApiCreatedResponse({ type: TaskSchema })
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
  @ApiOperation({
    summary: 'Detach a label from a task',
    description: 'Answers `200` with the task. The label itself is untouched.',
  })
  @ApiOkResponse({ type: TaskSchema })
  @WorkspaceRoles(...CONTENT_ROLES)
  removeLabel(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @UuidParam('labelId') labelId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TaskDto> {
    return this.taskService.removeLabel(workspaceId, taskId, user.id, labelId);
  }

  // Checklists are a content mutation, so they take CONTENT_ROLES like task create/update.
  // There is no read endpoint: checklists come back inside `GET tasks/:taskId`, and every
  // mutation answers with the same freshly-read task, so a caller never has to stitch two
  // responses together.
  //
  // Items address themselves shallowly (`checklist-items/:itemId`) rather than nesting under
  // their checklist: api-conventions puts create on the collection and addresses a single
  // resource by its own id, which is the same shape the task endpoints above already use.
  @Post('tasks/:taskId/checklists')
  @ApiOperation({
    summary: 'Add a checklist to a task',
    description:
      'There is no checklist read endpoint: every mutation here answers with the freshly-read ' +
      'task, and `GET tasks/{taskId}` carries the checklists in full.',
  })
  @ApiCreatedResponse({ type: TaskSchema })
  @WorkspaceRoles(...CONTENT_ROLES)
  createChecklist(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateChecklistDto,
  ): Promise<TaskDto> {
    return this.checklists.create(workspaceId, taskId, user.id, dto);
  }

  @Patch('tasks/:taskId/checklists/:checklistId')
  @ApiOperation({ summary: 'Rename a checklist' })
  @ApiOkResponse({ type: TaskSchema })
  @WorkspaceRoles(...CONTENT_ROLES)
  updateChecklist(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @UuidParam('checklistId') checklistId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateChecklistDto,
  ): Promise<TaskDto> {
    return this.checklists.update(workspaceId, taskId, user.id, checklistId, dto);
  }

  @Patch('tasks/:taskId/checklists/:checklistId/position')
  @ApiOperation({ summary: 'Reorder a checklist within its task' })
  @ApiOkResponse({ type: TaskSchema })
  @WorkspaceRoles(...CONTENT_ROLES)
  moveChecklist(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @UuidParam('checklistId') checklistId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MoveChecklistDto,
  ): Promise<TaskDto> {
    return this.checklists.move(workspaceId, taskId, user.id, checklistId, dto);
  }

  @Delete('tasks/:taskId/checklists/:checklistId')
  @ApiOperation({
    summary: 'Delete a checklist',
    description:
      'Answers `200` with the task, not `204` \u2014 the same exception every checklist route ' +
      'makes, and for the same reason: the card badge changes and the caller needs the new one.',
  })
  @ApiOkResponse({ type: TaskSchema })
  @WorkspaceRoles(...CONTENT_ROLES)
  removeChecklist(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @UuidParam('checklistId') checklistId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TaskDto> {
    return this.checklists.remove(workspaceId, taskId, user.id, checklistId);
  }

  @Post('tasks/:taskId/checklists/:checklistId/items')
  @ApiOperation({ summary: 'Add an item to a checklist' })
  @ApiCreatedResponse({ type: TaskSchema })
  @WorkspaceRoles(...CONTENT_ROLES)
  createChecklistItem(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @UuidParam('checklistId') checklistId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateChecklistItemDto,
  ): Promise<TaskDto> {
    return this.checklistItems.create(workspaceId, taskId, user.id, checklistId, dto);
  }

  @Patch('tasks/:taskId/checklist-items/:itemId')
  @ApiOperation({
    summary: 'Edit a checklist item, or tick it',
    description:
      'Addressed by its own id rather than through its checklist \u2014 the id already ' +
      'identifies the row and the workspace guard already scopes it.',
  })
  @ApiOkResponse({ type: TaskSchema })
  @WorkspaceRoles(...CONTENT_ROLES)
  updateChecklistItem(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @UuidParam('itemId') itemId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateChecklistItemDto,
  ): Promise<TaskDto> {
    return this.checklistItems.update(workspaceId, taskId, user.id, itemId, dto);
  }

  @Patch('tasks/:taskId/checklist-items/:itemId/position')
  @ApiOperation({ summary: 'Reorder a checklist item' })
  @ApiOkResponse({ type: TaskSchema })
  @WorkspaceRoles(...CONTENT_ROLES)
  moveChecklistItem(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @UuidParam('itemId') itemId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MoveChecklistItemDto,
  ): Promise<TaskDto> {
    return this.checklistItems.move(workspaceId, taskId, user.id, itemId, dto);
  }

  @Delete('tasks/:taskId/checklist-items/:itemId')
  @ApiOperation({ summary: 'Delete a checklist item' })
  @ApiOkResponse({ type: TaskSchema })
  @WorkspaceRoles(...CONTENT_ROLES)
  removeChecklistItem(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @UuidParam('itemId') itemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TaskDto> {
    return this.checklistItems.remove(workspaceId, taskId, user.id, itemId);
  }
}
