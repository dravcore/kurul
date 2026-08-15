import {
  acceptLanguageOf,
  resolveRecipientLocale,
  type StoredLocaleReader,
} from './recipient-locale';

/**
 * The rule that decides which language a person is written to in.
 *
 * It is worth a test of its own because the interesting case has no request behind it: an
 * invitation is sent to an address that may not have an account, from a hook Better Auth
 * calls after the inviter's request may already have been answered. Every link of the chain
 * below is the answer to "what do we know about this person" at a different level of
 * confidence, and the order between them is the product decision.
 */
const stored = (table: Record<string, string | null>): StoredLocaleReader => {
  return (email) => Promise.resolve(table[email] ?? null);
};

const invitee = 'invitee@example.test';
const inviter = 'inviter@example.test';

describe('resolveRecipientLocale', () => {
  it("uses the recipient's own stored preference above everything else", async () => {
    const locale = await resolveRecipientLocale(stored({ [invitee]: 'tr', [inviter]: 'en' }), {
      to: invitee,
      actorEmail: inviter,
      acceptLanguage: 'en-GB,en;q=0.9',
    });

    expect(locale).toBe('tr');
  });

  it("falls back to the sender's language when the address has no account yet", async () => {
    // The rule for a brand-new invitee: the inviter is the only person in the exchange whose
    // language is known, and they chose to write to this address.
    const locale = await resolveRecipientLocale(stored({ [inviter]: 'tr' }), {
      to: invitee,
      actorEmail: inviter,
      acceptLanguage: 'en-US,en;q=0.9',
    });

    expect(locale).toBe('tr');
  });

  it('falls back to the triggering request when neither party stored a preference', async () => {
    const locale = await resolveRecipientLocale(stored({}), {
      to: invitee,
      actorEmail: inviter,
      acceptLanguage: 'tr-TR,tr;q=0.9,en;q=0.8',
    });

    expect(locale).toBe('tr');
  });

  it('lands on English when nothing at all is known', async () => {
    const locale = await resolveRecipientLocale(stored({}), { to: invitee });

    expect(locale).toBe('en');
  });

  it('ignores a stored tag that is no longer a supported locale', async () => {
    // Dropping a language must leave those users falling through the chain, not pinned to a
    // catalog and a copy table that no longer exist.
    const locale = await resolveRecipientLocale(stored({ [invitee]: 'de' }), {
      to: invitee,
      acceptLanguage: 'tr',
    });

    expect(locale).toBe('tr');
  });

  it('widens a stored region subtag to its base language', async () => {
    const locale = await resolveRecipientLocale(stored({ [invitee]: 'tr-TR' }), { to: invitee });

    expect(locale).toBe('tr');
  });

  it('does not read the same address twice when the actor is the recipient', async () => {
    // The verification path passes no actor, but a caller that passed the recipient's own
    // address must not cost a second primary-key lookup on the hot sign-up path.
    const reads: string[] = [];
    const counting: StoredLocaleReader = (email) => {
      reads.push(email);
      return Promise.resolve('tr');
    };

    await resolveRecipientLocale(counting, { to: invitee, actorEmail: invitee });

    expect(reads).toEqual([invitee]);
  });

  it('degrades to the next link when the lookup throws', async () => {
    // A signup must not fail because the locale query did. Sending the email in the wrong
    // language is the smaller failure, and it is the one this picks.
    const failing: StoredLocaleReader = () => Promise.reject(new Error('database is down'));

    const locale = await resolveRecipientLocale(failing, {
      to: invitee,
      acceptLanguage: 'tr',
    });

    expect(locale).toBe('tr');
  });
});

describe('acceptLanguageOf', () => {
  it('reads the header off a request', () => {
    const request = new Request('http://localhost/x', {
      headers: { 'accept-language': 'tr-TR,tr;q=0.9' },
    });

    expect(acceptLanguageOf(request)).toBe('tr-TR,tr;q=0.9');
  });

  it('tolerates a hook called with no request at all', () => {
    // Better Auth types the second hook argument as optional, and an invitation resent from a
    // background job has none.
    expect(acceptLanguageOf(undefined)).toBeNull();
  });
});
