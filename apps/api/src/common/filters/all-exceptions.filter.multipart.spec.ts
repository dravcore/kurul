import {
  ArgumentsHost,
  Catch,
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
import type { Response } from 'express';
import type { IncomingMessage, Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
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

/** What `AllExceptionsFilter` finished handling, and the response it was handed. */
interface Handled {
  exception: unknown;
  response: Response;
}

let onHandled: ((handled: Handled) => void) | undefined;

/**
 * `AllExceptionsFilter` as it ships, telling the test what it handled. A client that left gets no
 * response to read, so what the filter did with its request is read here instead.
 */
@Catch()
class ObservedFilter extends AllExceptionsFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(exception, host);
    onHandled?.({ exception, response: host.switchToHttp().getResponse<Response>() });
  }
}

/** Resolves once the filter has handled the next exception. */
function nextHandled(): Promise<Handled> {
  return new Promise((resolve) => {
    onHandled = resolve;
  });
}

let onBodyFlowing: (() => void) | undefined;

/**
 * Resolves once the next request's body starts flowing, which is multer piping it into busboy: by
 * then multer listens for the client leaving. A client that leaves earlier, while the route's
 * guards still run, never reaches multer's listeners at all, and that is not the case under test.
 */
function bodyFlowing(): Promise<void> {
  return new Promise((resolve) => {
    onBodyFlowing = resolve;
  });
}

/** A raw connection to the app, so a test can stop mid-body the way a real client does. */
async function openConnection(server: Server): Promise<Socket> {
  if (!server.listening) {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  }
  const { port } = server.address() as AddressInfo;
  const socket = await new Promise<Socket>((resolve, reject) => {
    const opened: Socket = connect(port, '127.0.0.1', () => resolve(opened));
    opened.once('error', reject);
  });
  // Whatever the server does with a connection the test is about to abandon is not the question.
  socket.on('error', () => undefined);
  return socket;
}

const BOUNDARY = 'kurul-abandoned-upload';

/** An upload that announces far more than it sends: the file part stops a few dozen bytes in. */
const ABANDONED_UPLOAD =
  'POST /upload HTTP/1.1\r\nHost: localhost\r\n' +
  `Content-Type: multipart/form-data; boundary=${BOUNDARY}\r\n` +
  `Content-Length: ${MAX_BYTES * 2}\r\n\r\n` +
  `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\n` +
  'Content-Type: image/png\r\n\r\n' +
  'x'.repeat(64);

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
 *
 * It is the same proof for what multer hands on that is not a refusal of its own: an upload the
 * client abandons, and a `Content-Type` busboy cannot parse, both plain `Error`s that
 * `mapMultipartFailure` answers.
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
    // Ahead of the router, so it sees each request before `FileInterceptor` does. See `bodyFlowing`.
    app.use((req: IncomingMessage, _res: unknown, next: () => void) => {
      req.once('resume', () => onBodyFlowing?.());
      next();
    });
    app.useGlobalFilters(new ObservedFilter());
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

  /**
   * A client that stops sending halfway, at the socket, which is the only place it happens. multer
   * aborts the upload with a plain `Error('Request aborted')`, Nest passes it on, and until
   * `mapMultipartFailure` it was a 500 filed in Sentry as a server fault.
   */
  it('answers nothing and reports nothing when the client leaves mid-upload', async () => {
    const socket = await openConnection(app.getHttpServer() as unknown as Server);
    const flowing = bodyFlowing();
    const handled = nextHandled();

    socket.write(ABANDONED_UPLOAD);
    await flowing;
    socket.destroy();
    const { exception, response } = await handled;

    // The shape `mapMultipartFailure` expects, from the multer that ships.
    expect(Object.getPrototypeOf(exception)).toBe(Error.prototype);
    expect((exception as Error).message).toBe('Request aborted');
    // The connection was gone by the time the error arrived, so the filter wrote nothing.
    expect(response.writableEnded).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  /**
   * A `Content-Type` busboy cannot parse, thrown from multer's `try` as a plain `Error` and passed
   * on by Nest: a 500 and a report, for a header the client chose. `multipart/mixed` is one busboy
   * does not parse, and spaces around the `=` are syntax `type-is` accepts and busboy does not.
   */
  it.each<[string, string]>([
    ['multipart/mixed; boundary=x', 'Multipart: Unsupported content type'],
    ['multipart/form-data;  boundary = x', 'Multipart: Malformed content type'],
  ])('answers Content-Type "%s" with 400 in the envelope', async (contentType, message) => {
    const response = await request(app.getHttpServer())
      .post('/upload')
      .set('Content-Type', contentType)
      .send('--x--\r\n')
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message,
      path: '/upload',
      timestamp: expect.any(String),
    });
    expect(handler).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });
});
