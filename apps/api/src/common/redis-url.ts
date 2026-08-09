/** Parse `REDIS_URL` into ioredis / BullMQ connection options. */
export function parseRedisUrl(redisUrl: string): {
  host: string;
  port: number;
  password?: string;
} {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  };
}
