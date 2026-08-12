import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { NotificationModule } from '../notification/notification.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TaskAssigneeService } from './task-assignee.service';
import { TaskController } from './task.controller';
import { TaskEventsService } from './task-events.service';
import { TaskLabelService } from './task-label.service';
import { TaskReadService } from './task-read.service';
import { TaskService } from './task.service';

@Module({
  imports: [ActivityModule, NotificationModule, RealtimeModule],
  controllers: [TaskController],
  // TaskReadService and TaskEventsService stay unexported: they are the module's internals,
  // and the public surface is still TaskService alone (docs/coding-standards.md).
  providers: [
    TaskService,
    TaskAssigneeService,
    TaskLabelService,
    TaskReadService,
    TaskEventsService,
  ],
  exports: [TaskService],
})
export class TaskModule {}
