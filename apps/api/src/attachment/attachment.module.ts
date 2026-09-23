import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ActivityModule } from '../activity/activity.module';
import { PlanModule } from '../plan/plan.module';
import { UploadBudgetService } from '../common/rate-limit/upload-budget';
import { RealtimeModule } from '../realtime/realtime.module';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { AttachmentController } from './attachment.controller';
import { AttachmentDownloadService } from './attachment-download.service';
import { AttachmentService } from './attachment.service';
import { UploadBudgetGuard } from './upload-budget.guard';

@Module({
  imports: [
    ActivityModule,
    StorageModule,
    // The per-workspace byte quota is resolved through the plan layer now, so a workspace can
    // carry its own (ADR 0032). The instance-wide one still comes straight off StorageService.
    PlanModule,
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
        // ## `utf8`, because multer's default corrupts every non-ASCII filename
        //
        // `multer@2.3.0/index.js:22` is `this.defParamCharset = options.defParamCharset ||
        // 'latin1'`, while a browser writes the multipart `filename` parameter as UTF-8 bytes
        // (RFC 7578 §5.1). Under the default those bytes are decoded one-per-character, so
        // `ölçüm raporu.png` is stored, listed and served back as `Ã¶lÃ§Ã¼m raporu.png` —
        // measured through the real upload path, not reasoned about. Nothing about that is a
        // deployment's choice: it is a library default nobody in this repo ever set, and it is
        // wrong for every client this API has (phase plan §5 — "an unconfigured default is a
        // decision too, just one nobody made").
        defParamCharset: 'utf8',
        // ## `maxBytes` as it is, because multer 2.3.0 already makes the ceiling inclusive
        //
        // busboy fires its limit on equality: `busboy/lib/types/multipart.js:476` is
        // `if (fileSize === fileSizeLimit) … emit('limit')`, so a busboy limit of N rejects a
        // file of exactly N bytes. Up to multer 2.2.0 `limits.fileSize` reached busboy
        // unchanged, and this line carried a `+ 1` to turn that threshold into the inclusive
        // ceiling K2 publishes. multer 2.3.0 makes the same translation itself
        // (`lib/make-middleware.js:83` hands busboy `limits.fileSize + 1`), so a `+ 1` here
        // would now accept a file one byte over ATTACHMENT_MAX_BYTES.
        //
        // The byte matters in both directions. One byte tight is the failure ADR 0022:170-176
        // added the proxy line to prevent: the proxy half rejects a body that *exceeds* 26214400
        // and passes one that equals it (measured in #215), so an upload of exactly
        // ATTACHMENT_MAX_BYTES would clear Caddy and die at Nest, an untraceable 413 produced by
        // library semantics rather than by anything an operator configured. One byte loose
        // makes the published number wrong the other way. The multer that parses this body is
        // `@nestjs/platform-express`'s own, not the one imported above: Nest 11.2.1 pins it at
        // 2.2.0, and the `multer@<2.3.0` entry in the root `pnpm.overrides` is what lifts it.
        // The size-limit block of `attachment.e2e-spec.ts` fails on a drift either way: a file
        // of exactly the limit is a 201 there, and one byte over is a 413.
        //
        // ## `fieldArrayIndexLimit: 0`, because the upgrade alone does not close GHSA-535w
        //
        // append-field turns a field named `items[4294967294]` into a sparse array of that
        // length, and a second field `items[foo]` on the same base converts it to an object by
        // walking every slot. Measured through `FileInterceptor` on multer 2.3.0 with this
        // configuration minus the option: that one two-field request held the event loop for 74
        // seconds. multer's fix for GHSA-535w-7cp7-47q4 is this opt-in limit, not the upgrade,
        // and with it the same request is refused in a millisecond. No client of this route
        // sends a bracketed field name (the web app sends `kind` and `file`), so 0, the smallest
        // value the option takes, costs nothing. The refusal is a `MulterError` code Nest
        // 11.2.1's `transformException` does not know, so it reaches `AllExceptionsFilter`'s
        // `instanceof Error` branch: a 500 and a Sentry report, for a request no client sends.
        limits: { fileSize: storage.maxBytes, files: 1, fields: 8, fieldArrayIndexLimit: 0 },
      }),
    }),
  ],
  controllers: [AttachmentController],
  // The budget store is a provider here and not a global one: the upload route is its only
  // consumer, and the module that owns the route is the one that should own the connection's
  // lifecycle (`UploadBudgetService.onApplicationShutdown`).
  providers: [AttachmentService, AttachmentDownloadService, UploadBudgetService, UploadBudgetGuard],
})
export class AttachmentModule {}
