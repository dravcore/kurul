import { NotFoundException } from '@nestjs/common';
import { ActivityType, ColumnCategory, LabelColorSlot, type Locale } from '@kurul/shared-types';
import { ActivityService } from '../activity/activity.service';
import { LocaleService } from '../locale/locale.service';
import { PlanLimitsService } from '../plan/plan-limits.service';
import { PrismaService } from '../prisma/prisma.service';
import { BoardService } from './board.service';

const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51';

describe('BoardService', () => {
  function buildService(locale: Locale = 'en') {
    const prisma = {
      board: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      task: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
    };
    // The default transaction hands the same mock back as `tx`, so assertions on
    // `prisma.board.*` also cover the calls the service makes inside the transaction.
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    const localeService = { resolve: jest.fn().mockResolvedValue(locale) };
    const activityService = { record: jest.fn().mockResolvedValue({ id: 'activity' }) };
    // The board ceiling never refuses in this suite; only that `create` calls it is not
    // asserted here, so a stub that always resolves keeps every existing case unchanged.
    const planLimits = {
      assertBoardAvailable: jest.fn().mockResolvedValue(undefined),
      assertWorkspaceAvailable: jest.fn().mockResolvedValue(undefined),
      assertSeatAvailable: jest.fn().mockResolvedValue(undefined),
    } as unknown as PlanLimitsService;
    return {
      service: new BoardService(
        prisma as unknown as PrismaService,
        localeService as unknown as LocaleService,
        activityService as unknown as ActivityService,
        planLimits,
      ),
      prisma,
      localeService,
      activityService,
      planLimits,
    };
  }

  function boardRow() {
    return {
      id: BOARD_ID,
      workspaceId: WORKSPACE_ID,
      name: 'Roadmap',
      description: null,
      createdAt: new Date('2026-01-01'),
    };
  }

  it('creates a board and its default columns in one transaction', async () => {
    const { service, prisma } = buildService();
    const created = {
      id: BOARD_ID,
      workspaceId: WORKSPACE_ID,
      name: 'Roadmap',
      description: null,
      createdAt: new Date('2026-01-01'),
    };
    const create = jest.fn().mockResolvedValue(created);
    prisma.$transaction.mockImplementation((callback) => callback({ board: { create } }));

    await expect(
      service.create(WORKSPACE_ID, ACTOR_ID, { name: 'Roadmap' }),
    ).resolves.toMatchObject({
      id: BOARD_ID,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          // Each seed column carries its category explicitly. Spelled out rather than
          // asserted against `defaultColumnsFor`: a test that reuses the catalog it is
          // checking would pass just as happily if the Done column stopped being COMPLETED.
          columns: {
            create: [
              { name: 'To Do', position: 1000, category: ColumnCategory.UNSTARTED },
              { name: 'In Progress', position: 2000, category: ColumnCategory.STARTED },
              { name: 'Done', position: 3000, category: ColumnCategory.COMPLETED },
            ],
          },
        }),
      }),
    );
  });

  it('records the creation with the seeded stage names, in the same transaction', async () => {
    const { service, prisma, activityService } = buildService();
    const create = jest.fn().mockResolvedValue(boardRow());
    const tx = { board: { create } };
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    await service.create(WORKSPACE_ID, ACTOR_ID, { name: 'Roadmap' });

    expect(activityService.record).toHaveBeenCalledWith(tx, {
      workspaceId: WORKSPACE_ID,
      userId: ACTOR_ID,
      type: ActivityType.BoardCreated,
      payload: {
        boardId: BOARD_ID,
        name: 'Roadmap',
        seededColumns: ['To Do', 'In Progress', 'Done'],
      },
    });
  });

  describe('templates', () => {
    it('writes the named template’s columns and labels in the one nested create', async () => {
      const { service, prisma } = buildService();
      const create = jest.fn().mockResolvedValue(boardRow());
      prisma.$transaction.mockImplementation((callback) => callback({ board: { create } }));

      await service.create(WORKSPACE_ID, ACTOR_ID, { name: 'Triage', template: 'bug-triage' });

      // Spelled out rather than asserted against the catalog: a test that reuses the list it is
      // checking would pass just as happily if "Won't Fix" stopped being CANCELED.
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            columns: {
              create: [
                { name: 'Reported', position: 1000, category: ColumnCategory.BACKLOG },
                { name: 'Triaged', position: 2000, category: ColumnCategory.UNSTARTED },
                { name: 'Fixing', position: 3000, category: ColumnCategory.STARTED },
                { name: 'Verifying', position: 4000, category: ColumnCategory.STARTED },
                { name: 'Closed', position: 5000, category: ColumnCategory.COMPLETED },
                { name: 'Won’t Fix', position: 6000, category: ColumnCategory.CANCELED },
              ],
            },
            labels: {
              create: [
                { name: 'Critical', color: LabelColorSlot['slot-1'] },
                { name: 'Major', color: LabelColorSlot['slot-2'] },
                { name: 'Minor', color: LabelColorSlot['slot-3'] },
                { name: 'Regression', color: LabelColorSlot['slot-4'] },
                { name: 'Needs Info', color: LabelColorSlot['slot-5'] },
              ],
            },
          }),
        }),
      );
      // One write, not a board followed by a label pass: a failed second write would leave a
      // board standing with half a preset, which reads exactly like a team that deleted the
      // labels it did not want.
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('seeds a template in the language the creator reads', async () => {
      const { service, prisma } = buildService('tr');
      const create = jest.fn().mockResolvedValue(boardRow());
      prisma.$transaction.mockImplementation((callback) => callback({ board: { create } }));

      await service.create(WORKSPACE_ID, ACTOR_ID, { name: 'Akış', template: 'content-pipeline' });

      const { data } = create.mock.calls[0]![0] as {
        data: {
          columns: { create: { name: string }[] };
          labels: { create: { name: string }[] };
        };
      };
      expect(data.columns.create.map((column) => column.name)).toStrictEqual([
        'Fikirler',
        'Onaylandı',
        'Yazılıyor',
        'Düzenleniyor',
        'Yayında',
      ]);
      expect(data.labels.create.map((label) => label.name)).toStrictEqual([
        'Blog',
        'Sosyal Medya',
        'Video',
        'Bülten',
      ]);
    });

    it('writes no labels at all when no template is named', async () => {
      const { service, prisma } = buildService();
      const create = jest.fn().mockResolvedValue(boardRow());
      prisma.$transaction.mockImplementation((callback) => callback({ board: { create } }));

      await service.create(WORKSPACE_ID, ACTOR_ID, { name: 'Plain' });

      // Not an empty `labels.create` either. Every client that predates templates calls this
      // route without one, and a board that arrives carrying labels nobody asked for is a
      // behaviour change to all of them.
      const { data } = create.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(data).not.toHaveProperty('labels');
    });

    it('records which template was chosen, not only what it wrote', async () => {
      const { service, prisma, activityService } = buildService();
      const create = jest.fn().mockResolvedValue(boardRow());
      const tx = { board: { create } };
      prisma.$transaction.mockImplementation((callback) => callback(tx));

      await service.create(WORKSPACE_ID, ACTOR_ID, { name: 'Roadmap', template: 'scrum-sprint' });

      // The slug is the one part of the choice the seeded rows cannot be reverse-engineered
      // into: two templates could share a column list, and a team that later renames every
      // stage erases the only other evidence.
      expect(activityService.record).toHaveBeenCalledWith(tx, {
        workspaceId: WORKSPACE_ID,
        userId: ACTOR_ID,
        type: ActivityType.BoardCreated,
        payload: {
          boardId: BOARD_ID,
          name: 'Roadmap',
          seededColumns: ['Backlog', 'Sprint Backlog', 'In Progress', 'Review', 'Done'],
          template: 'scrum-sprint',
          seededLabels: ['Story', 'Bug', 'Spike', 'Tech Debt', 'Blocked'],
        },
      });
    });

    it('claims no template in the audit trail when none was chosen', async () => {
      const { service, prisma, activityService } = buildService();
      const create = jest.fn().mockResolvedValue(boardRow());
      prisma.$transaction.mockImplementation((callback) => callback({ board: { create } }));

      await service.create(WORKSPACE_ID, ACTOR_ID, { name: 'Roadmap' });

      // Absent, not `null` and not the default slug: the trail must not report a decision
      // nobody made.
      const [, entry] = activityService.record.mock.calls[0] as [unknown, { payload: object }];
      expect(entry.payload).not.toHaveProperty('template');
      expect(entry.payload).not.toHaveProperty('seededLabels');
    });

    it('lists the catalog in the reader’s language without touching the database', async () => {
      const { service, prisma, localeService } = buildService('tr');

      const templates = await service.listTemplates(ACTOR_ID, 'tr-TR');

      expect(localeService.resolve).toHaveBeenCalledWith(ACTOR_ID, 'tr-TR');
      expect(templates.map((template) => template.slug)).toStrictEqual([
        'kanban',
        'scrum-sprint',
        'bug-triage',
        'content-pipeline',
      ]);
      expect(templates[2]).toMatchObject({ slug: 'bug-triage', name: 'Hata Triyajı' });
      expect(templates[0]?.labels).toContainEqual({
        name: 'Hata',
        color: LabelColorSlot['slot-1'],
      });
      // A read of code, not of rows. If this ever starts querying, it has become a per-tenant
      // catalog and the route it hangs on is the wrong shape for one.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.board.findMany).not.toHaveBeenCalled();
    });
  });

  it('seeds the columns in the language the creator reads', async () => {
    const { service, prisma, localeService } = buildService();
    const create = jest.fn().mockResolvedValue({
      id: BOARD_ID,
      workspaceId: WORKSPACE_ID,
      name: 'Roadmap',
      description: null,
      createdAt: new Date('2026-01-01'),
    });
    prisma.$transaction.mockImplementation((callback) => callback({ board: { create } }));

    await service.create(WORKSPACE_ID, ACTOR_ID, { name: 'Roadmap' }, 'en-GB,en;q=0.9');

    // The creator's preference wins over the header, and the header is only consulted for a
    // user who has not set one — the ordering lives in `LocaleService.resolve`, so all this
    // asserts is that the board path actually asks it rather than hardcoding English.
    expect(localeService.resolve).toHaveBeenCalledWith(ACTOR_ID, 'en-GB,en;q=0.9');
  });

  it('returns 404 when a board is outside the workspace', async () => {
    const { service } = buildService();
    await expect(service.get(WORKSPACE_ID, BOARD_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('update', () => {
    it('carries the tenant scope on the write predicate, not just the check', async () => {
      const { service, prisma } = buildService();
      prisma.board.findFirst.mockResolvedValue({
        id: BOARD_ID,
        name: 'Roadmap',
        description: null,
      });
      prisma.board.update.mockResolvedValue(boardRow());

      await service.update(WORKSPACE_ID, BOARD_ID, ACTOR_ID, { name: 'Renamed' });

      expect(prisma.board.update).toHaveBeenCalledWith({
        where: { id: BOARD_ID, workspaceId: WORKSPACE_ID },
        data: { name: 'Renamed' },
      });
    });

    it('returns 404 and writes nothing for a board in another workspace', async () => {
      const { service, prisma, activityService } = buildService();
      prisma.board.findFirst.mockResolvedValue(null);

      await expect(
        service.update(WORKSPACE_ID, BOARD_ID, ACTOR_ID, { name: 'Hijacked' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.board.update).not.toHaveBeenCalled();
      expect(activityService.record).not.toHaveBeenCalled();
    });

    it('records the previous value, not only the new one', async () => {
      const { service, prisma, activityService } = buildService();
      prisma.board.findFirst.mockResolvedValue({
        id: BOARD_ID,
        name: 'Q3 Launch',
        description: null,
      });
      prisma.board.update.mockResolvedValue({ ...boardRow(), name: 'Archive' });

      await service.update(WORKSPACE_ID, BOARD_ID, ACTOR_ID, { name: 'Archive' });

      expect(activityService.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          userId: ACTOR_ID,
          type: ActivityType.BoardUpdated,
          payload: expect.objectContaining({
            boardId: BOARD_ID,
            changes: { name: { from: 'Q3 Launch', to: 'Archive' } },
          }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('deletes with the tenant predicate rather than the bare id', async () => {
      const { service, prisma } = buildService();
      prisma.board.findFirst.mockResolvedValue({ id: BOARD_ID, name: 'Roadmap' });

      await expect(service.remove(WORKSPACE_ID, BOARD_ID, ACTOR_ID)).resolves.toBeUndefined();
      expect(prisma.board.deleteMany).toHaveBeenCalledWith({
        where: { id: BOARD_ID, workspaceId: WORKSPACE_ID },
      });
      expect(prisma.board.delete).not.toHaveBeenCalled();
    });

    it('returns 404 and writes nothing for a board in another workspace', async () => {
      const { service, prisma, activityService } = buildService();
      prisma.board.findFirst.mockResolvedValue(null);

      await expect(service.remove(WORKSPACE_ID, BOARD_ID, ACTOR_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.board.deleteMany).not.toHaveBeenCalled();
      expect(activityService.record).not.toHaveBeenCalled();
    });

    it('returns 404 when the scoped delete matches no row', async () => {
      const { service, prisma } = buildService();
      // The row passed the in-transaction check but left the workspace before the write —
      // the scoped predicate is what catches it, and 404 is the cross-tenant answer.
      prisma.board.findFirst.mockResolvedValue({ id: BOARD_ID, name: 'Roadmap' });
      prisma.board.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove(WORKSPACE_ID, BOARD_ID, ACTOR_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('records the name and task count before the row that holds them is gone', async () => {
      const { service, prisma, activityService } = buildService();
      prisma.board.findFirst.mockResolvedValue({ id: BOARD_ID, name: 'Q3 Launch' });
      prisma.task.count.mockResolvedValue(87);

      await service.remove(WORKSPACE_ID, BOARD_ID, ACTOR_ID);

      expect(activityService.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          userId: ACTOR_ID,
          type: ActivityType.BoardDeleted,
          payload: { boardId: BOARD_ID, name: 'Q3 Launch', taskCount: 87 },
        }),
      );
      // Ordering is the point: the entry has to be written while the board still exists.
      const recordOrder = activityService.record.mock.invocationCallOrder[0]!;
      const deleteOrder = prisma.board.deleteMany.mock.invocationCallOrder[0]!;
      expect(recordOrder).toBeLessThan(deleteOrder);
    });
  });
});
