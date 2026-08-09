import { describe, expect, it } from 'vitest';
import {
  formatMentionMarkup,
  getActiveMentionQuery,
  insertMentionMarkup,
  parseMentions,
  tokenizeMentions,
} from './mentions';

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

describe('formatMentionMarkup / insertMentionMarkup', () => {
  const alice = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';

  it('formats the stored mention token', () => {
    expect(formatMentionMarkup('Alice', alice)).toBe(`@[Alice](${alice})`);
  });

  it('replaces an active @query at the caret', () => {
    const value = 'Hi @Al';
    const result = insertMentionMarkup(value, value.length, value.length, 'Alice', alice);
    expect(result.value).toBe(`Hi @[Alice](${alice}) `);
    expect(result.cursor).toBe(result.value.length);
  });

  it('inserts at the caret when there is no active query', () => {
    const value = 'Hi ';
    const result = insertMentionMarkup(value, 3, 3, 'Alice', alice);
    expect(result.value).toBe(`Hi @[Alice](${alice}) `);
  });
});

describe('getActiveMentionQuery', () => {
  it('reads the query after @', () => {
    expect(getActiveMentionQuery('ping @bo', 8)).toEqual({ start: 5, query: 'bo' });
  });

  it('ignores completed mention markup', () => {
    const alice = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';
    const value = `Hey @[Alice](${alice})`;
    expect(getActiveMentionQuery(value, value.length)).toBeNull();
  });
});

describe('tokenizeMentions', () => {
  const alice = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';

  it('splits text and mention chips', () => {
    expect(tokenizeMentions(`Hi @[Alice](${alice})!`)).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'mention', name: 'Alice', userId: alice },
      { kind: 'text', text: '!' },
    ]);
  });
});
