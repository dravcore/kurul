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

  it('accepts a file of exactly the published limit, because busboy fires on equality', async () => {
    // `busboy/lib/types/multipart.js`: `if (fileSize === fileSizeLimit) … emit('limit')`. Passing
    // the published ceiling would make the largest accepted file one byte smaller than the number
    // this repository documents — the untraceable off-by-one ADR 0022's proxy row exists to
    // prevent. Measured in P3-1.
    delete process.env.TRELLO_IMPORT_MAX_BYTES;

    expect((await multerOptions()).limits?.fileSize).toBe(DEFAULT_TRELLO_IMPORT_MAX_BYTES + 1);
  });

  it('resolves the limit per instantiation, not once per process', async () => {
    // `MulterModule.register` closes over an object built when the `@Module` decorator argument
    // was evaluated — i.e. at first import — so the limit would freeze and a test that set the
    // variable before building an app would silently exercise the default. Measured against the
    // library rather than assumed; this is why the module uses `registerAsync`.
    process.env.TRELLO_IMPORT_MAX_BYTES = '4096';
    expect((await multerOptions()).limits?.fileSize).toBe(4097);

    process.env.TRELLO_IMPORT_MAX_BYTES = '8192';
    expect((await multerOptions()).limits?.fileSize).toBe(8193);
  });

  it('decodes multipart parameters as UTF-8, not multer default latin1', async () => {
    // `multer@2.2.0/index.js`: `this.defParamCharset = options.defParamCharset || 'latin1'`,
    // while browsers write the `filename` parameter as UTF-8 bytes (RFC 7578 §5.1). Measured in
    // P3-1 to mangle every non-ASCII filename.
    const options = (await multerOptions()) as { defParamCharset?: string };

    expect(options.defParamCharset).toBe('utf8');
  });

  it('takes one file and no more', async () => {
    expect((await multerOptions()).limits?.files).toBe(1);
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
});
