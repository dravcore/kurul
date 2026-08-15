import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ActivityType, AttachmentKind, SocketEvents } from '@kurultay/shared-types';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AttachmentService } from './attachment.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d55';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54';
const ATTACHMENT_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';

function build() {
  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    task: {
      findFirst: jest.fn().mockResolvedValue({ id: TASK_ID, title: 'T', boardId: BOARD_ID }),
    },
    attachment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaService;
  const activity = {
    record: jest.fn().mockResolvedValue({ id: 'a' }),
  } as unknown as ActivityService;
  const realtime = { emitToBoard: jest.fn() } as unknown as RealtimeService;
  return {
    service: new AttachmentService(prisma, activity, realtime),
    prisma,
    activity,
    realtime,
  };
}

describe('AttachmentService.list', () => {
  it('carries the tenant scope through the task relation and orders newest first', async () => {
    const { service, prisma } = build();

    await service.list(WORKSPACE_ID, TASK_ID);

    expect(prisma.attachment.findMany).toHaveBeenCalledWith({
      where: { taskId: TASK_ID, task: { board: { workspaceId: WORKSPACE_ID } } },
      orderBy: { id: 'desc' },
    });
  });

  it('404s for a task in another workspace, before any attachment read', async () => {
    const { service, prisma } = build();
    (prisma.task.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.list(WORKSPACE_ID, TASK_ID)).rejects.toThrow(NotFoundException);
    expect(prisma.attachment.findMany).not.toHaveBeenCalled();
  });
});

describe('AttachmentService.findOne', () => {
  it('answers with the DTO and never with the storage key', async () => {
    const { service, prisma } = build();
    (prisma.attachment.findFirst as jest.Mock).mockResolvedValue({
      id: ATTACHMENT_ID,
      taskId: TASK_ID,
      kind: AttachmentKind.File,
      filename: 'contract.pdf',
      storageKey: '01/98/' + ATTACHMENT_ID,
      mimeType: 'application/pdf',
      size: 12,
      url: null,
      uploadedById: ACTOR_ID,
      createdAt: new Date(0),
      task: { boardId: BOARD_ID },
    });

    const dto = await service.findOne(WORKSPACE_ID, ATTACHMENT_ID);

    // `storageKey` is an internal address. Publishing it would invite a client to construct one,
    // which is the exact capability K9 removed.
    expect(dto).not.toHaveProperty('storageKey');
    expect(dto).toEqual({
      id: ATTACHMENT_ID,
      taskId: TASK_ID,
      kind: AttachmentKind.File,
      filename: 'contract.pdf',
      mimeType: 'application/pdf',
      size: 12,
      url: null,
      uploadedById: ACTOR_ID,
      createdAt: new Date(0).toISOString(),
    });
  });

  it('404s for an attachment in another workspace', async () => {
    const { service, prisma } = build();
    (prisma.attachment.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.findOne(WORKSPACE_ID, ATTACHMENT_ID)).rejects.toThrow(NotFoundException);
  });
});

describe('AttachmentService.createLink', () => {
  it('stores the url, writes an activity row and announces the task change', async () => {
    const { service, prisma, activity, realtime } = build();
    (prisma.attachment.create as jest.Mock).mockResolvedValue({
      id: ATTACHMENT_ID,
      taskId: TASK_ID,
      kind: AttachmentKind.Link,
      filename: 'Design file',
      storageKey: null,
      mimeType: null,
      size: null,
      url: 'https://example.com/a',
      uploadedById: ACTOR_ID,
      createdAt: new Date(0),
    });

    await service.createLink(WORKSPACE_ID, TASK_ID, ACTOR_ID, {
      kind: AttachmentKind.Link,
      url: 'https://example.com/a',
      filename: 'Design file',
    });

    expect((prisma.attachment.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      kind: AttachmentKind.Link,
      url: 'https://example.com/a',
      storageKey: null,
      mimeType: null,
      size: null,
    });
    expect((activity.record as jest.Mock).mock.calls[0][1]).toMatchObject({
      type: ActivityType.AttachmentCreated,
    });
    // The module emits TASK_UPDATED itself rather than borrowing TaskEventsService (D3 /
    // ADR 0024). The event name and the payload shape are what K5 promises, so both are asserted
    // — a future edit that invents `attachment:added` fails here, not in review.
    expect(realtime.emitToBoard).toHaveBeenCalledWith(BOARD_ID, SocketEvents.TASK_UPDATED, {
      workspaceId: WORKSPACE_ID,
      boardId: BOARD_ID,
      actorId: ACTOR_ID,
      taskId: TASK_ID,
    });
  });

  it('falls back to the url as the display name when no filename is given', async () => {
    const { service, prisma } = build();
    (prisma.attachment.create as jest.Mock).mockResolvedValue({
      id: ATTACHMENT_ID,
      taskId: TASK_ID,
      kind: AttachmentKind.Link,
      filename: 'https://example.com/a',
      storageKey: null,
      mimeType: null,
      size: null,
      url: 'https://example.com/a',
      uploadedById: ACTOR_ID,
      createdAt: new Date(0),
    });

    await service.createLink(WORKSPACE_ID, TASK_ID, ACTOR_ID, {
      kind: AttachmentKind.Link,
      url: 'https://example.com/a',
      filename: '   ',
    });

    expect((prisma.attachment.create as jest.Mock).mock.calls[0][0].data.filename).toBe(
      'https://example.com/a',
    );
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'ftp://x/y'])(
    'refuses %s — only http and https are storable',
    async (url) => {
      const { service, prisma } = build();

      await expect(
        service.createLink(WORKSPACE_ID, TASK_ID, ACTOR_ID, {
          kind: AttachmentKind.Link,
          url,
          filename: 'x',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.attachment.create).not.toHaveBeenCalled();
    },
  );

  it('refuses a string that is not a URL at all', async () => {
    const { service, prisma } = build();

    await expect(
      service.createLink(WORKSPACE_ID, TASK_ID, ACTOR_ID, {
        kind: AttachmentKind.Link,
        url: 'not a url',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });

  it('404s for a task in another workspace before it judges the url', async () => {
    const { service, prisma } = build();
    (prisma.task.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.createLink(WORKSPACE_ID, TASK_ID, ACTOR_ID, {
        kind: AttachmentKind.Link,
        url: 'https://example.com/a',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });
});

describe('AttachmentService.remove', () => {
  it('scopes the delete through the relation and writes the audit row', async () => {
    const { service, prisma, activity, realtime } = build();
    (prisma.attachment.findFirst as jest.Mock).mockResolvedValue({
      id: ATTACHMENT_ID,
      taskId: TASK_ID,
      filename: 'contract.pdf',
      kind: AttachmentKind.File,
      task: { boardId: BOARD_ID },
    });

    await service.remove(WORKSPACE_ID, ATTACHMENT_ID, ACTOR_ID);

    expect(prisma.attachment.deleteMany).toHaveBeenCalledWith({
      where: { id: ATTACHMENT_ID, task: { board: { workspaceId: WORKSPACE_ID } } },
    });
    expect((activity.record as jest.Mock).mock.calls[0][1]).toMatchObject({
      type: ActivityType.AttachmentDeleted,
    });
    expect(realtime.emitToBoard).toHaveBeenCalledWith(BOARD_ID, SocketEvents.TASK_UPDATED, {
      workspaceId: WORKSPACE_ID,
      boardId: BOARD_ID,
      actorId: ACTOR_ID,
      taskId: TASK_ID,
    });
  });

  // Görev 6 writes the body: the claim needs a real `StorageService` double, and the service
  // does not take one until the FILE path exists. A skipped todo is visible; a test that was
  // never written is not.
  it.todo('does not delete the bytes inline — the sweep owns that');

  it('raises not found when the attachment belongs to another workspace', async () => {
    const { service, prisma } = build();
    (prisma.attachment.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.remove(WORKSPACE_ID, ATTACHMENT_ID, ACTOR_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.attachment.deleteMany).not.toHaveBeenCalled();
  });

  it('raises not found when the row vanishes between the read and the write', async () => {
    const { service, prisma, activity, realtime } = build();
    (prisma.attachment.findFirst as jest.Mock).mockResolvedValue({
      id: ATTACHMENT_ID,
      taskId: TASK_ID,
      filename: 'contract.pdf',
      kind: AttachmentKind.File,
      task: { boardId: BOARD_ID },
    });
    (prisma.attachment.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

    await expect(service.remove(WORKSPACE_ID, ATTACHMENT_ID, ACTOR_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(activity.record).not.toHaveBeenCalled();
    expect(realtime.emitToBoard).not.toHaveBeenCalled();
  });
});
