import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ActivityType } from '@kurul/shared-types';
import type { ActivityService } from '../activity/activity.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PERSONAL_ACCESS_TOKEN_PREFIX, hashToken } from './personal-access-token';
import { LAST_USED_WRITE_INTERVAL_MS, TokenService } from './token.service';

const NOW = new Date('2026-08-23T12:00:00.000Z');

const USER = {
  id: 'u1',
  email: 'member@example.com',
  name: 'Member',
  avatarUrl: null,
  emailVerified: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
};

function buildService() {
  const prisma = {
    personalAccessToken: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 't1' }),
      updateMany: jest.fn(),
    },
  };
  const activityService = { record: jest.fn().mockResolvedValue({ id: 'a1' }) };
  const service = new TokenService(
    prisma as unknown as PrismaService,
    activityService as unknown as ActivityService,
  );
  return { service, prisma, activityService };
}

describe('TokenService.create', () => {
  it('stores the hash and prefix, returns the plaintext once, and records the activity', async () => {
    const { service, prisma, activityService } = buildService();
    prisma.personalAccessToken.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 't1',
          workspaceId: data.workspaceId,
          userId: data.userId,
          name: data.name,
          prefix: data.prefix,
          lastUsedAt: null,
          expiresAt: data.expiresAt,
          createdAt: NOW,
        }),
    );

    const created = await service.create('w1', 'u1', { name: '  CI runner  ' }, NOW);

    const written = prisma.personalAccessToken.create.mock.calls[0][0].data;
    expect(written.name).toBe('CI runner');
    expect(written.tokenHash).toBe(hashToken(created.token));
    expect(written.tokenHash).not.toContain(
      created.token.slice(PERSONAL_ACCESS_TOKEN_PREFIX.length),
    );
    expect(written.expiresAt).toBeNull();

    expect(created).toEqual({
      id: 't1',
      workspaceId: 'w1',
      userId: 'u1',
      name: 'CI runner',
      prefix: created.token.slice(0, PERSONAL_ACCESS_TOKEN_PREFIX.length + 8),
      lastUsedAt: null,
      expiresAt: null,
      createdAt: NOW.toISOString(),
      token: created.token,
    });

    expect(activityService.record).toHaveBeenCalledWith(prisma, {
      workspaceId: 'w1',
      userId: 'u1',
      type: ActivityType.TokenCreated,
      payload: { tokenId: 't1', name: 'CI runner', prefix: created.prefix, expiresAt: null },
    });
    // The activity payload must never carry the secret.
    expect(JSON.stringify(activityService.record.mock.calls[0][1])).not.toContain(created.token);
  });

  it('keeps a future expiry and refuses one that has already passed', async () => {
    const { service, prisma } = buildService();
    prisma.personalAccessToken.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 't1',
          workspaceId: 'w1',
          userId: 'u1',
          name: data.name,
          prefix: data.prefix,
          lastUsedAt: null,
          expiresAt: data.expiresAt,
          createdAt: NOW,
        }),
    );

    const future = new Date(NOW.getTime() + 86_400_000).toISOString();
    const created = await service.create('w1', 'u1', { name: 'x', expiresAt: future }, NOW);
    expect(created.expiresAt).toBe(future);

    await expect(
      service.create('w1', 'u1', { name: 'x', expiresAt: NOW.toISOString() }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.personalAccessToken.create).toHaveBeenCalledTimes(1);
  });
});

describe('TokenService.listForOwner', () => {
  it('lists only the caller’s live tokens in this workspace, newest first', async () => {
    const { service, prisma } = buildService();
    prisma.personalAccessToken.findMany.mockResolvedValue([
      {
        id: 't2',
        workspaceId: 'w1',
        userId: 'u1',
        name: 'b',
        prefix: 'kurul_pat_bbbbbbbb',
        lastUsedAt: NOW,
        expiresAt: null,
        createdAt: NOW,
      },
    ]);

    const listed = await service.listForOwner('w1', 'u1');

    expect(prisma.personalAccessToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'w1', userId: 'u1', revokedAt: null },
        orderBy: { id: 'desc' },
      }),
    );
    expect(listed).toEqual([
      {
        id: 't2',
        workspaceId: 'w1',
        userId: 'u1',
        name: 'b',
        prefix: 'kurul_pat_bbbbbbbb',
        lastUsedAt: NOW.toISOString(),
        expiresAt: null,
        createdAt: NOW.toISOString(),
      },
    ]);
  });
});

describe('TokenService.revoke', () => {
  it('stamps revokedAt on the caller’s own live token and records the activity', async () => {
    const { service, prisma, activityService } = buildService();
    prisma.personalAccessToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.personalAccessToken.findUniqueOrThrow.mockResolvedValue({
      name: 'CI runner',
      prefix: 'kurul_pat_aaaaaaaa',
    });

    await service.revoke('w1', 'u1', 't1');

    expect(prisma.personalAccessToken.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', workspaceId: 'w1', userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(activityService.record).toHaveBeenCalledWith(prisma, {
      workspaceId: 'w1',
      userId: 'u1',
      type: ActivityType.TokenRevoked,
      payload: { tokenId: 't1', name: 'CI runner', prefix: 'kurul_pat_aaaaaaaa' },
    });
  });

  it('answers 404 for another owner’s token, another workspace, or an already revoked one', async () => {
    const { service, prisma, activityService } = buildService();
    prisma.personalAccessToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.revoke('w1', 'u1', 't1')).rejects.toBeInstanceOf(NotFoundException);
    expect(activityService.record).not.toHaveBeenCalled();
  });
});

describe('TokenService.revokeAllForMember', () => {
  it('revokes every live token the user holds in that workspace and no other', async () => {
    const { service, prisma } = buildService();
    prisma.personalAccessToken.updateMany.mockResolvedValue({ count: 2 });

    await service.revokeAllForMember('w1', 'u1', NOW);

    expect(prisma.personalAccessToken.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', userId: 'u1', revokedAt: null },
      data: { revokedAt: NOW },
    });
  });
});

describe('TokenService.resolve', () => {
  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: 't1',
      workspaceId: 'w1',
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      user: USER,
      ...overrides,
    };
  }

  it('looks the token up by its hash, never by the plaintext', async () => {
    const { service, prisma } = buildService();
    prisma.personalAccessToken.findUnique.mockResolvedValue(row());

    const resolved = await service.resolve('kurul_pat_secret', NOW);

    expect(prisma.personalAccessToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashToken('kurul_pat_secret') } }),
    );
    expect(resolved).toEqual({
      id: 't1',
      workspaceId: 'w1',
      user: {
        id: 'u1',
        email: 'member@example.com',
        name: 'Member',
        avatarUrl: null,
        emailVerified: true,
        createdAt: USER.createdAt,
      },
    });
  });

  it.each([
    ['unknown', null],
    ['revoked', row({ revokedAt: NOW })],
    ['expired', row({ expiresAt: NOW })],
    ['owned by an anonymised account', row({ user: { ...USER, deletedAt: NOW } })],
  ])('answers null for a token that is %s', async (_label, stored) => {
    const { service, prisma } = buildService();
    prisma.personalAccessToken.findUnique.mockResolvedValue(stored);

    await expect(service.resolve('kurul_pat_secret', NOW)).resolves.toBeNull();
    expect(prisma.personalAccessToken.update).not.toHaveBeenCalled();
  });

  it('accepts a token whose expiry is still ahead', async () => {
    const { service, prisma } = buildService();
    prisma.personalAccessToken.findUnique.mockResolvedValue(
      row({ expiresAt: new Date(NOW.getTime() + 1000) }),
    );

    await expect(service.resolve('kurul_pat_secret', NOW)).resolves.not.toBeNull();
  });

  it('stamps lastUsedAt on first use and again only once the write interval has passed', async () => {
    const { service, prisma } = buildService();

    prisma.personalAccessToken.findUnique.mockResolvedValue(row({ lastUsedAt: null }));
    await service.resolve('kurul_pat_secret', NOW);
    expect(prisma.personalAccessToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: { lastUsedAt: NOW } }),
    );

    prisma.personalAccessToken.update.mockClear();
    prisma.personalAccessToken.findUnique.mockResolvedValue(
      row({ lastUsedAt: new Date(NOW.getTime() - LAST_USED_WRITE_INTERVAL_MS + 1) }),
    );
    await service.resolve('kurul_pat_secret', NOW);
    expect(prisma.personalAccessToken.update).not.toHaveBeenCalled();

    prisma.personalAccessToken.findUnique.mockResolvedValue(
      row({ lastUsedAt: new Date(NOW.getTime() - LAST_USED_WRITE_INTERVAL_MS) }),
    );
    await service.resolve('kurul_pat_secret', NOW);
    expect(prisma.personalAccessToken.update).toHaveBeenCalledTimes(1);
  });
});
