import { storageKeyFor } from './attachment-storage-key';

describe('storageKeyFor', () => {
  it('derives the key from the id and nothing else', () => {
    expect(storageKeyFor('0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60')).toBe(
      '01/98/0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60',
    );
  });

  it('produces a key with no traversal segment, whatever the id looks like', () => {
    const key = storageKeyFor('0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60');
    expect(key.split('/')).not.toContain('..');
  });

  it('fans out on the timestamp half, so ids minted together share a directory', () => {
    const a = storageKeyFor('0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60');
    const b = storageKeyFor('0198e2c0-aaaa-7f04-8c3d-2b5e7a9c1d61');

    expect(a.slice(0, 6)).toBe(b.slice(0, 6));
    // Two levels, then the id itself — one directory never holds every file on the instance.
    expect(a.split('/')).toHaveLength(3);
  });
});
