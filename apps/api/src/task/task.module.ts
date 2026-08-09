import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { NotificationModule } from '../notification/notification.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

@Module({
  imports: [ActivityModule, NotificationModule, RealtimeModule],
  controllers: [TaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
