import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { DueSoonWorker } from './due-soon.worker';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  // Depends on the module, not on the gateway: the service publishes through `RealtimeService`,
  // and the transport never learns what a notification is.
  imports: [RealtimeModule],
  controllers: [NotificationController],
  providers: [NotificationService, DueSoonWorker],
  exports: [NotificationService],
})
export class NotificationModule {}
