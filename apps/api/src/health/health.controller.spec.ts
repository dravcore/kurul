import { HttpStatus, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';
import { HealthService, type ReadinessReport } from './health.service';
import { PROBE_TIMEOUT_MS, ProbeTimeoutError, withTimeout } from './probe-timeout';
import { RedisHealthClient } from './redis-health.client';

/** Minimal stand-in for the Express response the readiness handler sets the status on. */
function responseStub(): { response: Response; status: jest.Mock } {
  const status = jest.fn();
  return { response: { status } as unknown as Response, status };
}

describe('HealthController', () => {
  let controller: HealthController;
  let checkReadiness: jest.Mock<Promise<ReadinessReport>, []>;

  beforeEach(async () => {
    checkReadiness = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: { checkReadiness } }],
    }).compile();

    controller = module.get(HealthController);
  });

  it('returns ok status', () => {
    expect(controller.check()).toEqual({ status: 'ok' });
  });

  it('answers liveness without consulting any dependency', () => {
    controller.check();
    expect(checkReadiness).not.toHaveBeenCalled();
  });

  it('answers readiness with 200 when every dependency is up', async () => {
    const report: ReadinessReport = { status: 'ok', checks: { database: 'up', redis: 'up' } };
    checkReadiness.mockResolvedValue(report);
    const { response, status } = responseStub();

    await expect(controller.ready(response)).resolves.toEqual(report);
    expect(status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('answers readiness with 503 and names the dependency that is down', async () => {
    const report: ReadinessReport = { status: 'error', checks: { database: 'up', redis: 'down' } };
    checkReadiness.mockResolvedValue(report);
    const { response, status } = responseStub();

    // The body is the probe's document, not the error envelope: an operator (or a compose
    // healthcheck log) reads `checks` to see that it is Redis, not Postgres, that is down.
    await expect(controller.ready(response)).resolves.toEqual(report);
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });
});

describe('HealthService', () => {
  function buildService() {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]) };
    const redis = {
      isConfigured: jest.fn().mockReturnValue(true),
      ping: jest.fn().mockResolvedValue('PONG'),
    };
    const service = new HealthService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisHealthClient,
    );

    return { service, prisma, redis };
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('reports ok when both dependencies answer', async () => {
    const { service } = buildService();

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('reports the database down when its probe rejects', async () => {
    const { service, prisma } = buildService();
    prisma.$queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'error',
      checks: { database: 'down', redis: 'up' },
    });
  });

  it('reports redis down when its ping rejects', async () => {
    const { service, redis } = buildService();
    redis.ping.mockRejectedValue(new Error('Connection is closed'));

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'error',
      checks: { database: 'up', redis: 'down' },
    });
  });

  it('names every broken dependency in one report', async () => {
    const { service, prisma, redis } = buildService();
    prisma.$queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));
    redis.ping.mockRejectedValue(new Error('Connection is closed'));

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'error',
      checks: { database: 'down', redis: 'down' },
    });
  });

  it('skips redis — and stays ready — when REDIS_URL is unset', async () => {
    const { service, redis } = buildService();
    redis.isConfigured.mockReturnValue(false);

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'skipped' },
    });
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('reports a hung dependency as down instead of waiting on it', async () => {
    jest.useFakeTimers();
    const { service, prisma } = buildService();
    // Never settles — a Postgres that accepted the connection and then stopped answering.
    prisma.$queryRaw.mockReturnValue(new Promise(() => undefined));

    const pending = service.checkReadiness();
    await jest.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({
      status: 'error',
      checks: { database: 'down', redis: 'up' },
    });
  });
});

describe('withTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('passes the result through when the work wins', async () => {
    await expect(withTimeout(Promise.resolve('PONG'), 'redis')).resolves.toBe('PONG');
  });

  it('rejects with a labelled timeout once the budget elapses', async () => {
    jest.useFakeTimers();
    const raced = withTimeout(new Promise(() => undefined), 'database', 50);
    jest.advanceTimersByTime(50);

    await expect(raced).rejects.toThrow(ProbeTimeoutError);
    await expect(raced).rejects.toThrow('database probe timed out after 50ms');
  });
});
