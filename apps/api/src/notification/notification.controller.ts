import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import type {
  CursorPage,
  NotificationDto,
  NotificationUnreadCountDto,
} from '@kurultay/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { ParseUuidV7Pipe } from '../common/pipes/parse-uuid-v7.pipe';
import type { AuthenticatedUser } from '../common/types/request-context';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationService } from './notification.service';

/** Nested under workspace for tenant scoping. Recipients only see their own rows. */
@Controller('workspaces/:workspaceId/notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @UseGuards(WorkspaceGuard)
  list(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationQueryDto,
  ): Promise<CursorPage<NotificationDto>> {
    return this.notificationService.list(workspaceId, user.id, query);
  }

  @Get('unread-count')
  @UseGuards(WorkspaceGuard)
  unreadCount(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationUnreadCountDto> {
    return this.notificationService.unreadCount(workspaceId, user.id);
  }

  @Post('read-all')
  @HttpCode(200)
  @UseGuards(WorkspaceGuard)
  markAllRead(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ updated: number }> {
    return this.notificationService.markAllRead(workspaceId, user.id);
  }

  @Post(':notificationId/read')
  @HttpCode(200)
  @UseGuards(WorkspaceGuard)
  markRead(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('notificationId', ParseUuidV7Pipe) notificationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationDto> {
    return this.notificationService.markRead(workspaceId, user.id, notificationId);
  }
}
