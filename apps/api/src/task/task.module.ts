import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { NotificationModule } from '../notification/notification.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ChecklistItemService } from './checklist-item.service';
import { ChecklistService } from './checklist.service';
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
  // and TaskService is still the only thing this module offers to other modules
  // (docs/coding-standards.md).
  //
  // Inside the module there are deliberately two wiring patterns, and the difference is worth
  // stating because the next reader will otherwise have to guess which one is right:
  //
  //   - TaskAssigneeService / TaskLabelService are reached *through* TaskService, which
  //     forwards to them. That is how they were introduced and there is no reason to churn it.
  //   - ChecklistService / ChecklistItemService are injected into TaskController directly.
  //
  // Checklists went direct because the alternative was eight more pass-through methods on
  // task.service.ts, which is 15.8 KB and which issue #40 already asks to split. Routing them
  // through it would have grown the exact file that is meant to shrink, to buy uniformity with
  // a pattern the module is trying to move away from. New sub-resources should follow the
  // checklist shape; the older two will follow it when #40 lands.
  providers: [
    TaskService,
    TaskAssigneeService,
    TaskLabelService,
    ChecklistService,
    ChecklistItemService,
    TaskReadService,
    TaskEventsService,
  ],
  exports: [TaskService],
})
export class TaskModule {}
