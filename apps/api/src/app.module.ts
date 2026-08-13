import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { BoardModule } from './board/board.module';
import { TaskModule } from './task/task.module';
import { LabelModule } from './label/label.module';
import { CommentModule } from './comment/comment.module';
import { ActivityModule } from './activity/activity.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationModule } from './notification/notification.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SessionAuthGuard } from './common/guards/session-auth.guard';
import { throttlerOptions } from './common/rate-limit/rate-limit';

@Module({
  imports: [
    ThrottlerModule.forRoot(throttlerOptions()),
    PrismaModule,
    HealthModule,
    AuthModule,
    MailModule,
    WorkspaceModule,
    BoardModule,
    TaskModule,
    LabelModule,
    CommentModule,
    ActivityModule,
    DashboardModule,
    NotificationModule,
    RealtimeModule,
  ],
  providers: [
    // Order matters: global guards run in registration order, and the throttler has to come
    // first so a flood is rejected before `SessionAuthGuard` spends a Better Auth session
    // lookup (and, on a cookie-cache miss, a database round trip) on it.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: SessionAuthGuard,
    },
  ],
})
export class AppModule {}
