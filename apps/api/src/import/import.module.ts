import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ActivityModule } from '../activity/activity.module';
import { PlanModule } from '../plan/plan.module';
import { ImportController } from './import.controller';
import { readTrelloImportMaxBytes } from './import-config';
import { TrelloImportService } from './trello-import.service';

@Module({
  imports: [
    ActivityModule,
    // `PlanModule` for the board ceiling alone (ADR 0032): an import creates a board, so it asks
    // the same question `BoardService.create` asks, from the same service. `PlanModule` brings
    // `StorageModule` with it for the byte quotas, and that is fine here: the importer never
    // calls `StorageService.write`, so an instance with no `STORAGE_PATH` still imports.
    PlanModule,
    // ## Its own MulterModule, not AttachmentModule's
    //
    // The two limits govern different costs (ADR 0025, `import-config.ts`): an attachment buys
    // disk, an import buys heap. Registering multipart here also keeps the importer working on an
    // instance with no `STORAGE_PATH`, where `StorageService.write` answers 503 — an import
    // stores no files, so tying it to file storage would join two features that have nothing to
    // do with each other.
    //
    // ## `registerAsync`, and the plan's reasoning for `register` was measured to be wrong
    //
    // The plan for this item argued `register` would do, because "its options object is still
    // evaluated when the module is instantiated". It is not. `MulterModule.register(options)`
    // registers `{ useFactory: () => options }` — a factory closing over an object that was built
    // when this `@Module({...})` decorator argument was *evaluated*, i.e. the first time this
    // file was imported. So `register` would read `TRELLO_IMPORT_MAX_BYTES` once per process and
    // freeze it, and an e2e that sets the variable before building an app would silently exercise
    // the default instead. `registerAsync`'s factory runs per module instantiation, which is
    // every `Test.createTestingModule` — the property `attachment.module.ts` documents, reached
    // here without a `StorageService` to inject.
    MulterModule.registerAsync({
      useFactory: () => ({
        // memoryStorage, not disk: the parser needs the whole body as a buffer, and a disk-backed
        // multer would write a temp file this code would then have to delete. Same call
        // `attachment.module.ts` makes, for the same reason.
        storage: memoryStorage(),
        // multer's default is `latin1` (`multer@2.2.0/index.js`), while a browser writes the
        // multipart `filename` parameter as UTF-8 bytes (RFC 7578 §5.1). Measured in P3-1: under
        // the default, a non-ASCII filename is mangled. Nothing here reads the filename today,
        // but a parser configured to corrupt its own inputs is not a default worth inheriting.
        defParamCharset: 'utf8',
        // `+ 1` because busboy fires its limit on *equality*
        // (`busboy/lib/types/multipart.js`: `if (fileSize === fileSizeLimit)`), so passing the
        // published ceiling would reject a file of exactly that size. Measured in P3-1; this is
        // not slack, and deleting it moves the published number by one byte.
        //
        // `files: 1` and `fields: 4`: this endpoint takes one part and no text fields at all, so
        // the field allowance is headroom rather than a requirement — the ceiling that matters is
        // `fileSize`.
        limits: { fileSize: readTrelloImportMaxBytes() + 1, files: 1, fields: 4 },
      }),
    }),
  ],
  controllers: [ImportController],
  providers: [TrelloImportService],
})
export class ImportModule {}
