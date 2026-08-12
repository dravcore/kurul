import { parseRedisUrl } from './redis-url';

describe('parseRedisUrl', () => {
  it('parses host, port, and password', () => {
    expect(parseRedisUrl('redis://:s3cret@localhost:6380/0')).toEqual({
      host: 'localhost',
      port: 6380,
      password: 's3cret',
    });
  });

  it('defaults port to 6379', () => {
    expect(parseRedisUrl('redis://127.0.0.1')).toEqual({
      host: '127.0.0.1',
      port: 6379,
    });
  });
});
