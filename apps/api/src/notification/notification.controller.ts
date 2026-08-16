import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CursorPage, NotificationDto, NotificationUnreadCountDto } from '@kurul/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import { WorkspaceScoped } from '../common/decorators/workspace-roles.decorator';
import type { AuthenticatedUser } from '../common/types/request-context';
import {
  MarkAllReadSchema,
  NotificationPageSchema,
  NotificationSchema,
  NotificationUnreadCountSchema,
} from '../openapi/schemas/feed.schema';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationService } from './notification.service';

/** Nested under workspace for tenant scoping. Recipients only see their own rows. */
@ApiTags('Notifications')
@Controller('workspaces/:workspaceId/notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({
    summary: "Page the caller's notifications",
    description:
      'Scoped to the caller as well as to the workspace \u2014 a recipient never sees another ' +
      "member's rows, whatever their role.",
  })
  @ApiOkResponse({ type: NotificationPageSchema })
  @WorkspaceScoped()
  list(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationQueryDto,
  ): Promise<CursorPage<NotificationDto>> {
    return this.notificationService.list(workspaceId, user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Count unread notifications',
    description:
      'A separate endpoint so the bell badge does not have to page the list. The socket event ' +
      '`notification:unread-changed` tells a connected client when to re-read it.',
  })
  @ApiOkResponse({ type: NotificationUnreadCountSchema })
  @WorkspaceScoped()
  unreadCount(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationUnreadCountDto> {
    return this.notificationService.unreadCount(workspaceId, user.id);
  }

  @Post('read-all')
  @ApiOperation({
    summary: 'Mark every notification read',
    description:
      'An action, so `200` with what it did rather than `201`. `updated: 0` means everything ' +
      'was already read and is not an error.',
  })
  @ApiOkResponse({ type: MarkAllReadSchema })
  @HttpCode(200)
  @WorkspaceScoped()
  markAllRead(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ updated: number }> {
    return this.notificationService.markAllRead(workspaceId, user.id);
  }

  @Post(':notificationId/read')
  @ApiOperation({
    summary: 'Mark one notification read',
    description: 'Answers with the row, so the caller can read the `readAt` the server stamped.',
  })
  @ApiOkResponse({ type: NotificationSchema })
  @HttpCode(200)
  @WorkspaceScoped()
  markRead(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('notificationId') notificationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationDto> {
    return this.notificationService.markRead(workspaceId, user.id, notificationId);
  }
}
