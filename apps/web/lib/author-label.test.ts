import { describe, expect, it } from 'vitest';
import { authorLabel } from './author-label';

describe('authorLabel', () => {
  it('prints a live author by name', () => {
    expect(authorLabel({ name: 'Ada Lovelace', deleted: false }, 'Silinmiş kullanıcı')).toBe(
      'Ada Lovelace',
    );
  });

  it('substitutes the localised label instead of the stored English tombstone', () => {
    // The DTO still carries `Deleted user` — that is what the database holds for an API
    // consumer that is not this app. The rendered string must not be it.
    expect(authorLabel({ name: 'Deleted user', deleted: true }, 'Silinmiş kullanıcı')).toBe(
      'Silinmiş kullanıcı',
    );
  });

  it('reads the flag and never the name', () => {
    // The one thing this must not become: a string comparison against the stored tombstone.
    // `Deleted user` is a display name any live account is free to choose, and someone who
    // chose it is not deleted.
    expect(authorLabel({ name: 'Deleted user', deleted: false }, 'Silinmiş kullanıcı')).toBe(
      'Deleted user',
    );
  });
});
