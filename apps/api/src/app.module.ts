import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';
import { AttachmentModule } from './attachment/attachment.module';
import { StorageModule } from './storage/storage.module';
import { InstanceConfigModule } from './config/instance-config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AccountModule } from './account/account.module';
import { MailModule } from './mail/mail.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { BoardModule } from './board/board.module';
import { TaskModule } from './task/task.module';
import { LabelModule } from './label/label.module';
import { CommentModule } from './comment/comment.module';
import { ImportModule } from './import/import.module';
import { ActivityModule } from './activity/activity.module';
import { ActivationModule } from './activation/activation.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationModule } from './notification/notification.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RetentionModule } from './retention/retention.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { TokenModule } from './token/token.module';
import { SessionAuthGuard } from './common/guards/session-auth.guard';
import { throttlerOptions } from './common/rate-limit/rate-limit';

@Module({
  imports: [
    ThrottlerModule.forRoot(throttlerOptions()),
    PrismaModule,
    HealthModule,
    // Ahead of `InstanceConfigModule` so the reading order follows the dependency: the config
    // document asks `StorageService` whether this deployment stores attachments at all.
    StorageModule,
    AttachmentModule,
    InstanceConfigModule,
    AuthModule,
    // Right after `AuthModule`, whose `/me` routes it sits beside: `GET /me` and `PATCH /me`
    // are the profile, `DELETE /me` is the end of it.
    AccountModule,
    MailModule,
    // Global, like `AuthModule`: `SessionAuthGuard` depends on its service, and that guard is
    // instantiated in every module that names it.
    TokenModule,
    WorkspaceModule,
    BoardModule,
    TaskModule,
    LabelModule,
    CommentModule,
    // After `BoardModule`, whose rows it writes; it carries its own MulterModule rather than
    // sharing `AttachmentModule`'s, because an import needs no file storage at all.
    ImportModule,
    ActivityModule,
    ActivationModule,
    DashboardModule,
    NotificationModule,
    RealtimeModule,
    RetentionModule,
    TelemetryModule,
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
