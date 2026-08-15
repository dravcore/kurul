import { readFile } from 'node:fs/promises';
import { createTempStorageDir, removeTempStorageDir } from '../../test/helpers/storage';
import { DiskStorageBackend } from './disk-storage-backend';

const KEY = '01/98/0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';

describe('DiskStorageBackend', () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempStorageDir();
  });
  afterEach(async () => {
    await removeTempStorageDir(root);
  });

  it('reports that it persists files', () => {
    expect(new DiskStorageBackend(root).persistsFiles).toBe(true);
  });

  it('writes bytes under the root and reads them back', async () => {
    const backend = new DiskStorageBackend(root);
    await backend.write(KEY, Buffer.from('hello'));

    const absolute = backend.resolve(KEY);
    expect(absolute.startsWith(root)).toBe(true);
    expect(await readFile(absolute, 'utf8')).toBe('hello');
  });

  it('refuses a key that would escape the root', async () => {
    const backend = new DiskStorageBackend(root);
    await expect(backend.write('../escaped', Buffer.from('x'))).rejects.toThrow(
      /outside the storage root/,
    );
  });

  it('does not fail when removing a key that is already gone', async () => {
    await expect(new DiskStorageBackend(root).remove('01/98/missing')).resolves.toBeUndefined();
  });

  /**
   * A root that is not an absolute path is refused at construction.
   *
   * This is not theoretical. `resolve('', key)` is `join(cwd, key)`, and `relative('', that)` is
   * just the key — so the traversal check in `resolve()` sees nothing wrong and the backend
   * writes into whatever directory the process happens to be running from. It was observed:
   * a mutation run that made `readStorageConfig` return a `disk` config unconditionally left a
   * real `apps/api/01/98/k` on disk. `readStorageConfig` is what keeps an empty `STORAGE_PATH`
   * from getting here, but a port whose only defence is its caller is a port with no defence, so
   * the constructor refuses instead of trusting.
   */
  it.each(['', '   ', 'relative/path', './attachments'])(
    'refuses a root that is not an absolute path: %p',
    (root) => {
      expect(() => new DiskStorageBackend(root)).toThrow(/absolute path/);
    },
  );

  it('lists what it wrote, with the key it was given', async () => {
    const backend = new DiskStorageBackend(root);
    await backend.write(KEY, Buffer.from('hello'));

    const seen: string[] = [];
    for await (const entry of backend.listKeys()) seen.push(entry.key);
    expect(seen).toEqual([KEY]);
  });
});
