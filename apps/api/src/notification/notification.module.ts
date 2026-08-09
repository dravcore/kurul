import { Module } from '@nestjs/common';
import { DueSoonWorker } from './due-soon.worker';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  controllers: [NotificationController],
  providers: [NotificationService, DueSoonWorker],
  exports: [NotificationService],
})
export class NotificationModule {}
