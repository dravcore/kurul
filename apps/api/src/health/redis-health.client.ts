import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { envString } from '../common/env';
import { parseRedisUrl } from '../common/redis-url';
import { PROBE_TIMEOUT_MS } from './probe-timeout';

/** The slice of a Redis client readiness needs, so a spec can hand in a stub instead of a socket. */
interface RedisProbe {
  isConfigured(): boolean;
  ping(): Promise<unknown>;
}

/**
 * Owns the one connection readiness uses to ask Redis whether it is alive.
 *
 * Deliberately not the gateway's pub/sub pair: those belong to Socket.io's adapter, are only
 * created outside the test environment, and a probe that borrowed them would report on a
 * client whose failure mode is "adapter never attached" rather than on Redis itself.
 */
@Injectable()
export class RedisHealthClient implements RedisProbe, OnModuleDestroy {
  private readonly logger = new Logger(RedisHealthClient.name);
  private client: Redis | null = null;

  /** False when `REDIS_URL` is unset — see how `HealthService` grades that. */
  isConfigured(): boolean {
    return envString('REDIS_URL', '') !== '';
  }

  async ping(): Promise<unknown> {
    return this.connection().ping();
  }

  /**
   * The probe client is created on first use and then kept: reconnecting is ioredis's job, and
   * a fresh client per probe would pay for a TCP handshake (and register another error
   * listener) every few seconds. `lazyConnect` is what keeps a process that never probes — a
   * unit test, a deployment with no `REDIS_URL` — from opening a socket nobody closes.
   */
  private connection(): Redis {
    if (!this.client) {
      const client = new Redis({
        ...parseRedisUrl(envString('REDIS_URL', '')),
        lazyConnect: true,
        // ioredis gives up on its own just as the probe's own race would, so a black-holed
        // Redis surfaces as a Redis error in the log rather than an opaque timeout.
        connectTimeout: PROBE_TIMEOUT_MS,
        commandTimeout: PROBE_TIMEOUT_MS,
        // A PING queued while the connection is down must not sit there across reconnect
        // attempts: one retry, then reject, so *this* probe reports down and the next one
        // gets to ask again.
        maxRetriesPerRequest: 1,
      });
      // ioredis emits `error` on every failed reconnect; an EventEmitter with no `error`
      // listener turns the first one into an uncaught exception and takes the API down. The
      // probe result is what the endpoint reports, so this only has to keep the log honest.
      client.on('error', (error: Error) => {
        this.logger.debug(`Redis readiness connection error: ${error.message}`);
      });
      this.client = client;
    }

    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client;
    this.client = null;
    await client?.quit().catch(() => undefined);
  }
}
