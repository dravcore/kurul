import {
  Controller,
  HttpCode,
  INestApplication,
  Logger,
  Post,
  UploadedFile,
  UseInterceptors,
  type DynamicModule,
  type FactoryProvider,
} from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { FileInterceptor, MulterModule } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AttachmentModule } from '../../attachment/attachment.module';
import { ImportModule } from '../../import/import.module';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** Small, because only the existence of an over-limit file matters here, not its size. */
const MAX_BYTES = 4096;

/** Records whether the handler ran, so "refused before the handler" is observable. */
const handler = jest.fn();

/**
 * Stands in for both multipart routes. The real controllers need a session, a workspace and a
 * database, and none of them takes part in a refusal multer makes before the handler runs; the
 * same reasoning as `configure-app.spec.ts`'s upload probe.
 */
@Controller()
class UploadProbeController {
  @Post('upload')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file?: { size: number }): { received: boolean } {
    handler(file);
    return { received: file !== undefined };
  }
}

/**
 * The multer options `module` registers, from its own `MULTER_MODULE_OPTIONS` factory.
 *
 * Called rather than read, for the reason `import.module.spec.ts` gives: both modules use
 * `registerAsync`, so the options are built per instantiation, and calling the factory is how
 * Nest builds them.
 */
async function registeredMulterOptions(
  module: { name: string },
  ...deps: unknown[]
): Promise<MulterOptions> {
  const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) as unknown[];
  const multer = imports.find(
    (entry): entry is DynamicModule =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as DynamicModule).module === MulterModule,
  );
  const provider = (multer?.providers ?? []).find(
    (entry): entry is FactoryProvider<MulterOptions | Promise<MulterOptions>> =>
      typeof entry === 'object' &&
      entry !== null &&
      'provide' in entry &&
      entry.provide === 'MULTER_MODULE_OPTIONS',
  );
  if (provider === undefined) throw new Error(`${module.name} registered no multer options`);
  return provider.useFactory(...deps);
}

async function importOptions(): Promise<MulterOptions> {
  const original = process.env.TRELLO_IMPORT_MAX_BYTES;
  process.env.TRELLO_IMPORT_MAX_BYTES = String(MAX_BYTES);
  try {
    return await registeredMulterOptions(ImportModule);
  } finally {
    if (original === undefined) delete process.env.TRELLO_IMPORT_MAX_BYTES;
    else process.env.TRELLO_IMPORT_MAX_BYTES = original;
  }
}

/**
 * What a multer refusal becomes once it has been through the real stack: busboy parsing a real
 * multipart body, multer 2.3.0 refusing it, Nest's `transformException` passing it on, and
 * `AllExceptionsFilter` answering. `all-exceptions.filter.spec.ts` pins the mapping on errors it
 * builds itself; this is the proof that what multer throws for a real request has the shape the
 * mapping expects.
 *
 * Each route is driven with the options its own module registers, so what is under test is the
 * configuration that ships rather than a copy of it.
 */
describe.each<[string, () => Promise<MulterOptions>]>([
  // The only thing the attachment factory reads from `StorageService` is the size ceiling.
  [
    'the attachment upload',
    () => registeredMulterOptions(AttachmentModule, { maxBytes: MAX_BYTES }),
  ],
  ['the Trello import', importOptions],
])('a multer refusal on %s, through FileInterceptor', (_route, options) => {
  let app: INestApplication<App>;
  let logError: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MulterModule.register(await options())],
      controllers: [UploadProbeController],
    }).compile();

    app = moduleRef.createNestApplication<App>({ logger: false });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  beforeEach(() => {
    handler.mockClear();
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logError.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  // The control. The 400 below says something about the field names only if the same route,
  // with the same options, takes a well-formed upload.
  it('accepts a well-formed upload', async () => {
    await request(app.getHttpServer())
      .post('/upload')
      .field('kind', 'FILE')
      .attach('file', Buffer.alloc(16, 1), 'x.png')
      .expect(201, { received: true });
  });

  /**
   * GHSA-535w-7cp7-47q4's request. Without `fieldArrayIndexLimit` it held the event loop for 74
   * seconds (measured, `attachment.module.ts`). With the limit, multer refuses the first field
   * with `LIMIT_FIELD_ARRAY_INDEX`, a code `@nestjs/platform-express` 11.2.1 does not translate,
   * and until `mapMulterError` existed that refusal was a 500 filed in Sentry as a server fault.
   */
  it('answers an out-of-range array index in a field name with 400 in the envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/upload')
      .field('items[4294967294]', 'a')
      .field('items[foo]', 'b')
      .attach('file', Buffer.alloc(16, 1), 'x.png')
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Field name array index too large - items[4294967294]',
      path: '/upload',
      timestamp: expect.any(String),
    });
    expect(handler).not.toHaveBeenCalled();
    // `reportFailure` logs and reports together, so no log line means no Sentry event either.
    expect(logError).not.toHaveBeenCalled();
  });

  // The limit that was already mapped, still mapped: Nest turns `LIMIT_FILE_SIZE` into its own
  // `PayloadTooLargeException` before the filter sees it, and nothing here may change that.
  it('still answers an over-limit file with 413', async () => {
    const response = await request(app.getHttpServer())
      .post('/upload')
      .attach('file', Buffer.alloc(MAX_BYTES + 1, 1), 'x.png')
      .expect(413);

    expect(response.body).toMatchObject({
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'File too large',
    });
    expect(handler).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });
});
