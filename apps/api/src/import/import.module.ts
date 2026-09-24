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
        // multer's default is `latin1` (`multer@2.3.0/index.js`), while a browser writes the
        // multipart `filename` parameter as UTF-8 bytes (RFC 7578 §5.1). Measured in P3-1: under
        // the default, a non-ASCII filename is mangled. Nothing here reads the filename today,
        // but a parser configured to corrupt its own inputs is not a default worth inheriting.
        defParamCharset: 'utf8',
        // The published ceiling as it is, with no `+ 1`. busboy fires its limit on *equality*
        // (`busboy/lib/types/multipart.js`: `if (fileSize === fileSizeLimit)`), which is why
        // this line used to add one byte: up to multer 2.2.0, passing the published ceiling
        // rejected a file of exactly that size (measured in P3-1). multer 2.3.0 adds the byte
        // itself before handing the limit to busboy, so a `+ 1` here would now accept a file one
        // byte over it. Either drift moves the published number by one byte, and the body-limit
        // cases in `trello-import.e2e-spec.ts` fail on both. The multer that parses this body
        // is `@nestjs/platform-express`'s own, lifted to 2.3.0 by the root `pnpm.overrides`.
        //
        // `files: 1` and `fields: 4`: this endpoint takes one part and no text fields at all, so
        // the field allowance is headroom rather than a requirement — the ceiling that matters is
        // `fileSize`.
        //
        // `fieldArrayIndexLimit: 0` for GHSA-535w-7cp7-47q4, which multer 2.3.0 fixes only when
        // the option is set: two fields, `items[4294967294]` and then `items[foo]`, held the
        // event loop for 74 seconds without it (measured and explained in `attachment.module.ts`,
        // whose route has the same exposure). Four fields are headroom, and nothing that posts
        // here sends a field at all, so the smallest value costs nothing.
        //
        // What a refusal becomes is `AllExceptionsFilter`'s to decide, the same for both routes,
        // and `attachment.module.ts` walks through it: a `400` in the error envelope (`413` for
        // the file's size), and a `400` too for the two plain errors multer passes on, a client
        // that left mid-upload and a `Content-Type` busboy cannot parse. None is reported.
        limits: {
          fileSize: readTrelloImportMaxBytes(),
          files: 1,
          fields: 4,
          fieldArrayIndexLimit: 0,
        },
      }),
    }),
  ],
  controllers: [ImportController],
  providers: [TrelloImportService],
})
export class ImportModule {}
