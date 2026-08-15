import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ActivityModule } from '../activity/activity.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { AttachmentController } from './attachment.controller';
import { AttachmentDownloadService } from './attachment-download.service';
import { AttachmentService } from './attachment.service';

@Module({
  imports: [
    ActivityModule,
    StorageModule,
    // The module announces TASK_UPDATED itself rather than borrowing TaskModule's
    // TaskEventsService: these endpoints answer with AttachmentDto, so there is no task response
    // to keep in step with the broadcast, and that guarantee was the only thing the borrowed
    // service added (ADR 0024, plan decision D3). Precedent: comment.module.ts:9.
    RealtimeModule,
    // Multer's options are resolved through DI here, not in the controller's decorator.
    // `FileInterceptor('file', { limits })` reads its options when the controller file is
    // *imported*, which freezes ATTACHMENT_MAX_BYTES for the life of the process and puts this
    // module out of step with how the rest of the codebase reads configuration
    // (`retentionSettings()` per run, `MailService.isEnabled()` per call). Through the factory
    // the value is resolved every time a module is instantiated — which is every
    // `Test.createTestingModule`, so an e2e can set the limit before building the app and
    // actually exercise it (plan decision D5).
    MulterModule.registerAsync({
      imports: [StorageModule],
      inject: [StorageService],
      useFactory: (storage: StorageService) => ({
        // memoryStorage, not disk: a disk-backed multer creates a file before validation runs,
        // and the sniffer needs `file.buffer` anyway (D5, K12).
        //
        // ## The accepted cost, measured rather than estimated
        //
        // The plan's estimate was "N concurrent uploads <= N x ATTACHMENT_MAX_BYTES of heap".
        // Driving this exact multer configuration in an isolated process (client in a separate
        // process, so no request-side buffer is counted), with a 24 MiB body and the 25 MiB
        // default limit, peak RSS above baseline came out at:
        //
        //   N=1   54 MiB   2.17x  (N x MAX)
        //   N=4  172 MiB   1.72x
        //   N=8  302 MiB   1.51x
        //
        // So the real factor is roughly **1.5-2.2x the estimate**, not 1x. The single-upload
        // case is the worst of the three, which is the shape of busboy accumulating chunks and
        // `Buffer.concat` then producing a second copy of the whole file. Anyone raising
        // ATTACHMENT_MAX_BYTES should budget against the measured factor.
        storage: memoryStorage(),
        limits: { fileSize: storage.maxBytes, files: 1, fields: 8 },
      }),
    }),
  ],
  controllers: [AttachmentController],
  providers: [AttachmentService, AttachmentDownloadService],
})
export class AttachmentModule {}
