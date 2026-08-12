import { parseMentions } from './parse-mentions';

describe('parseMentions', () => {
  const alice = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';
  const bob = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54';

  it('extracts unique UUIDv7 user ids from @[Name](id) tokens', () => {
    const body = `Hey @[Alice](${alice}) and @[Bob](${bob}) — also @[Alice](${alice}) again`;
    expect(parseMentions(body)).toEqual([alice, bob]);
  });

  it('ignores non-UUIDv7 and bare @names', () => {
    const body = '@Alice @[Bob](not-a-uuid) @[Carol](0198e2c0-9a1b-4f04-8c3d-2b5e7a9c1d55) hi';
    expect(parseMentions(body)).toEqual([]);
  });

  it('returns an empty list when there are no mentions', () => {
    expect(parseMentions('plain comment')).toEqual([]);
  });

  it('still reads a mention whose name is long but plausible', () => {
    const name = 'A'.repeat(200);
    expect(parseMentions(`@[${name}](${alice})`)).toEqual([alice]);
  });

  it('stops reading a name past the bound rather than scanning the rest of the body', () => {
    // This is the regression guard for the ReDoS fix, and it is deliberately an assertion
    // about the bound rather than about elapsed time. Unbounded, `[^\]]*` matches this name
    // and the test passes; bounded, it cannot. A timing assertion would not discriminate —
    // the quadratic case costs ~22ms against the 10 000-character body ceiling, which any
    // reasonable time limit lets through.
    //
    // The bound is not a product rule about names: 201 characters is not something the
    // mention picker can produce, so refusing it costs nothing real.
    const name = 'A'.repeat(201);
    expect(parseMentions(`@[${name}](${alice})`)).toEqual([]);
  });
});
