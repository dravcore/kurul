import { parseRedisUrl } from './redis-url';

/**
 * These are shape tests, not the proof that the database index reaches Redis. A parser can
 * return `{ db: 3 }` while every call site drops it on the floor — which is exactly what
 * #190 was. `test/redis-database-index.e2e-spec.ts` opens real connections through the real
 * consumers and asks the server which database they landed on; that is the test that goes
 * red if the fix is reverted.
 */
describe('parseRedisUrl', () => {
  it('parses host, port, and password', () => {
    expect(parseRedisUrl('redis://:s3cret@localhost:6380/0')).toEqual({
      host: 'localhost',
      port: 6380,
      password: 's3cret',
      db: 0,
    });
  });

  it('defaults port to 6379', () => {
    expect(parseRedisUrl('redis://127.0.0.1')).toEqual({
      host: '127.0.0.1',
      port: 6379,
    });
  });

  it('carries the database index from the URL path', () => {
    expect(parseRedisUrl('redis://localhost:6379/3')).toEqual({
      host: 'localhost',
      port: 6379,
      db: 3,
    });
  });

  it('accepts the index as a db query parameter', () => {
    expect(parseRedisUrl('redis://localhost:6379?db=7')).toEqual({
      host: 'localhost',
      port: 6379,
      db: 7,
    });
  });

  /** An index nobody asked for must stay absent, so ioredis keeps its own default. */
  it.each(['redis://localhost:6379', 'redis://localhost:6379/'])('omits db for %s', (url) => {
    expect(parseRedisUrl(url)).not.toHaveProperty('db');
  });

  it('rejects a non-numeric index rather than falling back to 0', () => {
    expect(() => parseRedisUrl('redis://localhost:6379/staging')).toThrow(/database index/);
  });

  it('rejects a negative index', () => {
    expect(() => parseRedisUrl('redis://localhost:6379/-1')).toThrow(/database index/);
  });

  it('rejects a path and query that disagree instead of picking one', () => {
    expect(() => parseRedisUrl('redis://localhost:6379/3?db=4')).toThrow(/disagree/);
  });

  it('accepts a path and query that agree', () => {
    expect(parseRedisUrl('redis://localhost:6379/3?db=3')).toMatchObject({ db: 3 });
  });
});
