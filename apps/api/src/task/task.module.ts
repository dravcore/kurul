import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { NotificationModule } from '../notification/notification.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TaskAssigneeService } from './task-assignee.service';
import { TaskController } from './task.controller';
import { TaskLabelService } from './task-label.service';
import { TaskService } from './task.service';

@Module({
  imports: [ActivityModule, NotificationModule, RealtimeModule],
  controllers: [TaskController],
  providers: [TaskService, TaskAssigneeService, TaskLabelService],
  exports: [TaskService],
})
export class TaskModule {}
