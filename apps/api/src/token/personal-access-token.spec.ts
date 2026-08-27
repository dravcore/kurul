import { createHash } from 'node:crypto';
import {
  PERSONAL_ACCESS_TOKEN_PREFIX,
  displayPrefixOf,
  hashToken,
  mintToken,
  parseBearerHeader,
} from './personal-access-token';

describe('mintToken', () => {
  it('mints a prefixed secret whose stored forms never contain the secret', () => {
    const minted = mintToken();

    expect(minted.plaintext.startsWith(PERSONAL_ACCESS_TOKEN_PREFIX)).toBe(true);
    // 32 random bytes in base64url is 43 characters, none of them padding.
    expect(minted.plaintext).toHaveLength(PERSONAL_ACCESS_TOKEN_PREFIX.length + 43);
    expect(minted.plaintext).not.toContain('=');
    expect(minted.hash).toBe(createHash('sha256').update(minted.plaintext).digest('hex'));
    expect(minted.hash).not.toContain(minted.plaintext.slice(PERSONAL_ACCESS_TOKEN_PREFIX.length));
    expect(minted.prefix).toBe(minted.plaintext.slice(0, PERSONAL_ACCESS_TOKEN_PREFIX.length + 8));
  });

  it('never mints the same secret twice', () => {
    const seen = new Set(Array.from({ length: 50 }, () => mintToken().plaintext));
    expect(seen.size).toBe(50);
  });
});

describe('hashToken', () => {
  it('is deterministic, so a lookup by hash finds the row the mint wrote', () => {
    const minted = mintToken();
    expect(hashToken(minted.plaintext)).toBe(minted.hash);
  });

  it('keeps the display prefix short enough to be useless as a credential', () => {
    expect(displayPrefixOf('kurul_pat_abcdefghijklmnop')).toBe('kurul_pat_abcdefgh');
  });
});

describe('parseBearerHeader', () => {
  it('reports no header as absent, so the cookie path decides', () => {
    expect(parseBearerHeader(undefined)).toEqual({ kind: 'absent' });
  });

  it('extracts a Kurul token whatever the case of the scheme', () => {
    expect(parseBearerHeader('Bearer kurul_pat_abc')).toEqual({
      kind: 'token',
      plaintext: 'kurul_pat_abc',
    });
    expect(parseBearerHeader('bearer   kurul_pat_abc ')).toEqual({
      kind: 'token',
      plaintext: 'kurul_pat_abc',
    });
  });

  it.each([
    ['Basic dXNlcjpwYXNz', 'another scheme'],
    ['Bearer', 'no credential'],
    ['Bearer ', 'blank credential'],
    ['Bearer eyJhbGciOiJIUzI1NiJ9.a.b', 'somebody else’s bearer token'],
    ['Bearer kurul_pat_', 'the prefix with nothing after it'],
    ['kurul_pat_abc', 'a bare token with no scheme'],
    ['Bearer kurul_pat_abc extra', 'trailing garbage'],
  ])('rejects %s (%s) as invalid rather than ignoring it', (header) => {
    expect(parseBearerHeader(header)).toEqual({ kind: 'invalid' });
  });

  it('rejects a repeated header rather than picking one of the credentials', () => {
    expect(parseBearerHeader(['Bearer kurul_pat_a', 'Bearer kurul_pat_b'])).toEqual({
      kind: 'invalid',
    });
  });
});
