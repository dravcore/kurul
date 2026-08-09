import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import type {
  CursorPage,
  NotificationDto,
  NotificationUnreadCountDto,
} from '@kurultay/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import { WorkspaceScoped } from '../common/decorators/workspace-roles.decorator';
import type { AuthenticatedUser } from '../common/types/request-context';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationService } from './notification.service';

/** Nested under workspace for tenant scoping. Recipients only see their own rows. */
@Controller('workspaces/:workspaceId/notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @WorkspaceScoped()
  list(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationQueryDto,
  ): Promise<CursorPage<NotificationDto>> {
    return this.notificationService.list(workspaceId, user.id, query);
  }

  @Get('unread-count')
  @WorkspaceScoped()
  unreadCount(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationUnreadCountDto> {
    return this.notificationService.unreadCount(workspaceId, user.id);
  }

  @Post('read-all')
  @HttpCode(200)
  @WorkspaceScoped()
  markAllRead(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ updated: number }> {
    return this.notificationService.markAllRead(workspaceId, user.id);
  }

  @Post(':notificationId/read')
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
