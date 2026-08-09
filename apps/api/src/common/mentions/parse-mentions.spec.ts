import { parseMentions } from './parse-mentions';

describe('parseMentions', () => {
  const alice = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';
  const bob = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54';

  it('extracts unique UUIDv7 user ids from @[Name](id) tokens', () => {
    const body = `Hey @[Alice](${alice}) and @[Bob](${bob}) — also @[Alice](${alice}) again`;
    expect(parseMentions(body)).toEqual([alice, bob]);
  });

  it('ignores non-UUIDv7 and bare @names', () => {
    const body =
      '@Alice @[Bob](not-a-uuid) @[Carol](0198e2c0-9a1b-4f04-8c3d-2b5e7a9c1d55) hi';
    expect(parseMentions(body)).toEqual([]);
  });

  it('returns an empty list when there are no mentions', () => {
    expect(parseMentions('plain comment')).toEqual([]);
  });
});
