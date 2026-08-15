import { parseMentions } from './parse-mentions';
import { DEFAULT_MENTION_REDACTION, redactMentionsOf } from './redact-mentions';

describe('redactMentionsOf', () => {
  const alice = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';
  const bob = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54';

  it('replaces the display name and keeps the id', () => {
    const body = `Hey @[Ada Lovelace](${alice}), see this`;
    expect(redactMentionsOf(body, alice)).toBe(
      `Hey @[${DEFAULT_MENTION_REDACTION}](${alice}), see this`,
    );
  });

  it('rewrites every mention of the same user in one body', () => {
    const body = `@[Ada](${alice}) asked @[Ada](${alice}) again`;
    const redacted = redactMentionsOf(body, alice);

    // Assert the count before asserting over the contents: `[].every(...)` is true, so a
    // regex that matched nothing would satisfy a "no occurrence of the old name" check alone.
    const rewritten = redacted.match(new RegExp(DEFAULT_MENTION_REDACTION, 'g')) ?? [];
    expect(rewritten).toHaveLength(2);
    expect(redacted).not.toContain('Ada');
  });

  it('leaves other people in the same body alone', () => {
    const body = `@[Ada](${alice}) and @[Grace](${bob}) are both here`;
    const redacted = redactMentionsOf(body, alice);

    expect(redacted).toContain(`@[Grace](${bob})`);
    expect(redacted).not.toContain('Ada');
  });

  it('keeps the mention parseable, so the comment still resolves the person it addressed', () => {
    // The point of rewriting the name instead of deleting the token: a reply that reads
    // "@[Deleted user] you were right" is still a sentence, and the highlight still renders.
    const body = `@[Ada](${alice}) and @[Grace](${bob})`;
    const parsed = parseMentions(redactMentionsOf(body, alice));

    expect(parsed).toHaveLength(2);
    expect(parsed).toEqual([alice, bob]);
  });

  it('does not touch a body with no mention of that user', () => {
    const body = `nothing to see, @[Grace](${bob})`;
    expect(redactMentionsOf(body, alice)).toBe(body);
  });

  it('treats the id case-insensitively, matching parseMentions', () => {
    const body = `@[Ada](${alice.toUpperCase()})`;
    expect(redactMentionsOf(body, alice)).toBe(`@[${DEFAULT_MENTION_REDACTION}](${alice})`);
  });

  it('accepts an explicit replacement', () => {
    expect(redactMentionsOf(`@[Ada](${alice})`, alice, 'Silinmiş kullanıcı')).toBe(
      `@[Silinmiş kullanıcı](${alice})`,
    );
  });

  it('leaves a name past the length bound alone rather than scanning the rest of the body', () => {
    // Same bound and same reasoning as `parse-mentions.spec.ts`: a 201-character name is not
    // something the picker can bind, and refusing to match it is what keeps the pattern linear.
    // It is also the honest outcome — `parseMentions` cannot see that token either, so a body
    // this shape was never a mention of anybody.
    const body = `@[${'A'.repeat(201)}](${alice})`;
    expect(redactMentionsOf(body, alice)).toBe(body);
  });

  it('does not let a user id containing regex metacharacters match more than itself', () => {
    // Ids are UUIDv7 and cannot contain these, so this is a guard on the escaping rather than
    // on a reachable input: an unescaped `.` would let one deletion rewrite another user's
    // mentions.
    const body = `@[Ada](${alice})`;
    const wildcard = alice.replace(/^./, '.');
    expect(redactMentionsOf(body, wildcard)).toBe(body);
  });
});
