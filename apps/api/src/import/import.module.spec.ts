import type { DynamicModule, FactoryProvider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { DEFAULT_TRELLO_IMPORT_MAX_BYTES } from './import-config';
import { ImportModule } from './import.module';

/** The token `MulterModule` publishes its resolved options under. */
const MULTER_MODULE_OPTIONS = 'MULTER_MODULE_OPTIONS';

function importedModules(): unknown[] {
  return Reflect.getMetadata(MODULE_METADATA.IMPORTS, ImportModule) as unknown[];
}

/**
 * The multer options `ImportModule` registers, resolved the way Nest resolves them.
 *
 * The factory is *called* rather than read, and that is the point of this helper: what is being
 * checked is not only the values but *when* they are produced. `MulterModule.register` would hand
 * back a closure over an object built when this file was first imported; `registerAsync` builds
 * one per instantiation.
 */
async function multerOptions(): Promise<MulterOptions> {
  const multer = importedModules().find(
    (entry): entry is DynamicModule =>
      typeof entry === 'object' && entry !== null && 'providers' in entry,
  );
  const provider = (multer?.providers ?? []).find(
    (entry): entry is FactoryProvider<MulterOptions | Promise<MulterOptions>> =>
      typeof entry === 'object' &&
      entry !== null &&
      'provide' in entry &&
      entry.provide === MULTER_MODULE_OPTIONS,
  );
  if (provider === undefined) throw new Error('ImportModule registered no multer options');
  return provider.useFactory();
}

describe('ImportModule multipart configuration', () => {
  const original = process.env.TRELLO_IMPORT_MAX_BYTES;

  afterEach(() => {
    if (original === undefined) delete process.env.TRELLO_IMPORT_MAX_BYTES;
    else process.env.TRELLO_IMPORT_MAX_BYTES = original;
  });

  it('buffers the body in memory rather than on disk', async () => {
    // A disk-backed multer would write a temp file this code then has to delete, and the parser
    // needs the whole body as a buffer anyway.
    const options = await multerOptions();

    expect(options.storage).toBeDefined();
    expect(options.dest).toBeUndefined();
  });

  it('passes the published limit through as is, because multer 2.3.0 makes it inclusive', async () => {
    // `busboy/lib/types/multipart.js`: `if (fileSize === fileSizeLimit) … emit('limit')`, so a
    // busboy limit of N rejects a file of exactly N bytes. Under multer 2.2.0 that made the
    // largest accepted file one byte smaller than the number this repository documents, the
    // untraceable off-by-one ADR 0022's proxy row exists to prevent, and this module added the
    // byte back (measured in P3-1). multer 2.3.0 hands busboy `limits.fileSize + 1` itself
    // (`lib/make-middleware.js`), so the old `+ 1` would now accept a file one byte over the
    // limit. Measured again through `FileInterceptor` when 2.3.0 arrived.
    delete process.env.TRELLO_IMPORT_MAX_BYTES;

    expect((await multerOptions()).limits?.fileSize).toBe(DEFAULT_TRELLO_IMPORT_MAX_BYTES);
  });

  it('resolves the limit per instantiation, not once per process', async () => {
    // `MulterModule.register` closes over an object built when the `@Module` decorator argument
    // was evaluated — i.e. at first import — so the limit would freeze and a test that set the
    // variable before building an app would silently exercise the default. Measured against the
    // library rather than assumed; this is why the module uses `registerAsync`.
    process.env.TRELLO_IMPORT_MAX_BYTES = '4096';
    expect((await multerOptions()).limits?.fileSize).toBe(4096);

    process.env.TRELLO_IMPORT_MAX_BYTES = '8192';
    expect((await multerOptions()).limits?.fileSize).toBe(8192);
  });

  it('decodes multipart parameters as UTF-8, not multer default latin1', async () => {
    // `multer@2.3.0/index.js`: `this.defParamCharset = options.defParamCharset || 'latin1'`,
    // while browsers write the `filename` parameter as UTF-8 bytes (RFC 7578 §5.1). Measured in
    // P3-1 to mangle every non-ASCII filename.
    const options = (await multerOptions()) as { defParamCharset?: string };

    expect(options.defParamCharset).toBe('utf8');
  });

  it('takes one file and no more', async () => {
    expect((await multerOptions()).limits?.files).toBe(1);
  });

  it('caps array indexes in field names, which multer 2.3.0 leaves uncapped by default', async () => {
    // GHSA-535w-7cp7-47q4: `items[4294967294]` and then `items[foo]` walk a sparse array of that
    // length on the event loop, and multer closes it only when this option is set. Nest 11.2.1's
    // `MulterOptions` does not declare the option yet, hence the widened read.
    const limits = (await multerOptions()).limits as { fieldArrayIndexLimit?: number } | undefined;

    expect(limits?.fieldArrayIndexLimit).toBe(0);
  });

  it("bounds a part's name, which busboy's multipart parser never does", async () => {
    // busboy 1.6.0 reports every multipart name as untruncated, whatever `fieldNameSize` says, so
    // a name was bounded only by the 16 KiB of its part's header block. multer 2.3.0 applies the
    // option itself, and only once it is set (measured in `attachment.module.ts`).
    expect((await multerOptions()).limits?.fieldNameSize).toBe(64);
  });

  it('gives a text value next to no room, because nothing here reads one', async () => {
    // busboy holds up to `fieldSize` bytes of each text field in memory, 1 MiB when nothing sets
    // it, so the four fields `fields` allows could hold 4 MiB of heap that no code reads.
    expect((await multerOptions()).limits?.fieldSize).toBe(1024);
  });

  it('does not depend on file storage at all', () => {
    // An import writes LINK rows and stores no bytes, so it has to work on an instance with no
    // STORAGE_PATH — where `StorageService.write` answers 503. Importing StorageModule here would
    // join two features that have no relationship, and nothing else would notice.
    const named = importedModules().map((entry) =>
      typeof entry === 'function' ? entry.name : ((entry as DynamicModule).module?.name ?? ''),
    );

    expect(named).not.toContain('StorageModule');
    expect(named).not.toContain('AttachmentModule');
    // The control half: the read finds the modules that *are* imported.
    expect(named).toContain('ActivityModule');
  });

  it('imports the plan layer, because an import is a board create by another route', () => {
    // ADR 0032: the board ceiling is enforced at every write that adds a board, and this module
    // owns one of the two. Dropping `PlanModule` here would make `TrelloImportService` fail to
    // resolve at boot, but this assertion names the reason rather than leaving it to a DI error.
    const named = importedModules().map((entry) =>
      typeof entry === 'function' ? entry.name : ((entry as DynamicModule).module?.name ?? ''),
    );

    expect(named).toContain('PlanModule');
  });
});
