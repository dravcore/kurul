import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { ActivityType } from '@kurultay/shared-types';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  IMPORT_CHUNK_SIZE,
  TRELLO_IMPORT_TRANSACTION_MAX_WAIT_MS,
  TRELLO_IMPORT_TRANSACTION_TIMEOUT_MS,
} from './import-config';
import { TrelloImportService } from './trello-import.service';

const FIXTURE_DIR = join(__dirname, '..', '..', 'test', 'fixtures', 'trello');
const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51';

function fixtureBytes(name: string): Buffer {
  return readFileSync(join(FIXTURE_DIR, `${name}.json`));
}

/**
 * A synthetic export big enough to cross `IMPORT_CHUNK_SIZE`.
 *
 * Built here rather than committed as a fixture: it measures the *writer*, not Trello's schema,
 * and a 1500-card JSON file in the repository would look like evidence about the second.
 */
function largeExportBytes(cardCount: number): Buffer {
  const listId = '6512c0000000000000000001';
  return Buffer.from(
    JSON.stringify({
      name: 'A big board',
      desc: null,
      lists: [{ id: listId, name: 'Everything', closed: false, pos: 16384 }],
      labels: [],
      checklists: [],
      members: [],
      actions: [],
      cards: Array.from({ length: cardCount }, (_unused, index) => ({
        id: `6512c000000000000000${(index + 4096).toString(16).padStart(4, '0')}`,
        name: `Card ${index}`,
        desc: '',
        closed: false,
        due: null,
        idList: listId,
        idLabels: [],
        idMembers: [],
        pos: (index + 1) * 1024,
        attachments: [],
      })),
    }),
  );
}

type CreateManyMock = { createMany: jest.Mock };

function buildService() {
  const tx = {
    board: { create: jest.fn().mockResolvedValue({}) },
    column: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    label: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    task: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    taskLabel: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    checklist: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    checklistItem: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    attachment: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  /** Every write in call order, so the ordering assertions read one list rather than seven. */
  const calls: string[] = [];
  for (const [model, client] of Object.entries(tx)) {
    if (model === 'board') continue;
    (client as CreateManyMock).createMany.mockImplementation(() => {
      calls.push(model);
      return Promise.resolve({ count: 0 });
    });
  }
  tx.board.create.mockImplementation(() => {
    calls.push('board');
    return Promise.resolve({});
  });

  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const activity = { record: jest.fn().mockResolvedValue({ id: 'activity' }) };

  return {
    service: new TrelloImportService(
      prisma as unknown as PrismaService,
      activity as unknown as ActivityService,
    ),
    prisma,
    activity,
    tx,
    calls,
  };
}

describe('TrelloImportService', () => {
  it('answers with the report the planner produced', async () => {
    const { service } = buildService();

    const report = await service.importBoard(
      WORKSPACE_ID,
      ACTOR_ID,
      fixtureBytes('synthetic-full-board'),
    );

    expect(report.boardName).toBe('Product Roadmap');
    expect(report.imported).toEqual({
      columns: 3,
      tasks: 4,
      labels: 5,
      checklists: 3,
      checklistItems: 5,
      attachments: 2,
    });
    expect(report.skipped.length).toBeGreaterThan(0);
  });

  it('writes everything in one transaction, with an explicit timeout', async () => {
    const { service, prisma } = buildService();

    await service.importBoard(WORKSPACE_ID, ACTOR_ID, fixtureBytes('synthetic-full-board'));

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      // Prisma's 5 s default is what this argument exists to replace. Without it, the only thing
      // between a 500-card import and an unreadable P2028 is luck.
      expect.objectContaining({
        timeout: TRELLO_IMPORT_TRANSACTION_TIMEOUT_MS,
        maxWait: TRELLO_IMPORT_TRANSACTION_MAX_WAIT_MS,
      }),
    );
  });

  it('creates the board before its columns and the columns before their tasks', async () => {
    const { service, calls } = buildService();

    await service.importBoard(WORKSPACE_ID, ACTOR_ID, fixtureBytes('synthetic-full-board'));

    // `Task.column` is a composite foreign key on `(boardId, columnId)`, so this order is a
    // constraint rather than a style. `taskLabel` after `task` and `label` for the same reason,
    // and `checklistItem` after `checklist`.
    expect(calls).toEqual([
      'board',
      'column',
      'label',
      'task',
      'taskLabel',
      'checklist',
      'checklistItem',
      'attachment',
    ]);
  });

  it('records one activity row for the whole board, not one per card', async () => {
    const { service, activity } = buildService();

    await service.importBoard(WORKSPACE_ID, ACTOR_ID, fixtureBytes('synthetic-full-board'));

    expect(activity.record).toHaveBeenCalledTimes(1);
    // Both halves matter. `times(1)` alone would allow the single row to be the wrong type, and
    // the type assertion alone would allow one row per card.
    expect(activity.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        userId: ACTOR_ID,
        type: ActivityType.BoardImported,
        payload: expect.objectContaining({
          source: 'trello',
          imported: expect.objectContaining({ tasks: 4 }),
          skippedTotal: expect.any(Number),
        }),
      }),
    );
  });

  it('writes the activity row with the transaction client, not the base one', async () => {
    const { service, activity, tx } = buildService();

    await service.importBoard(WORKSPACE_ID, ACTOR_ID, fixtureBytes('synthetic-full-board'));

    // An activity row written outside the transaction would survive a rollback and record a
    // board that does not exist.
    expect(activity.record.mock.calls[0]?.[0]).toBe(tx);
  });

  it('reports the same skipped total the report carries', async () => {
    const { service, activity } = buildService();

    const report = await service.importBoard(
      WORKSPACE_ID,
      ACTOR_ID,
      fixtureBytes('synthetic-full-board'),
    );
    const payload = activity.record.mock.calls[0]?.[1] as {
      payload: { skippedTotal: number };
    };

    expect(payload.payload.skippedTotal).toBe(
      report.skipped.reduce((total, group) => total + group.count, 0),
    );
    expect(payload.payload.skippedTotal).toBeGreaterThan(0);
  });

  it('never broadcasts: the board it creates has no room to broadcast into', () => {
    // The absence of a call cannot be asserted with a mock here, because `RealtimeService` is not
    // a dependency of this service at all — `expect(realtime.emitToBoard).not.toHaveBeenCalled()`
    // would pass against a mock that was never wired to anything and would measure nothing. What
    // is actually being pinned is that this file does not reach for the realtime layer.
    const source = readFileSync(join(__dirname, 'trello-import.service.ts'), 'utf8');
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');

    expect(code).not.toMatch(/Realtime|emitTo/);
    // The control half: the same read finds the calls that *are* made, so a typo in the regex or
    // a wrong path cannot make the assertion above pass by finding nothing.
    expect(code).toMatch(/this\.activity\.record/);
    expect(code).toMatch(/\$transaction/);
  });

  it('chunks a large board rather than issuing one unbounded statement', async () => {
    const { service, tx } = buildService();

    const report = await service.importBoard(WORKSPACE_ID, ACTOR_ID, largeExportBytes(2_500));

    expect(report.imported.tasks).toBe(2_500);
    expect(tx.task.createMany).toHaveBeenCalledTimes(3);
    const sizes = tx.task.createMany.mock.calls.map(
      (call) => (call[0] as { data: unknown[] }).data.length,
    );
    expect(sizes).toEqual([1000, 1000, 500]);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(IMPORT_CHUNK_SIZE);
  });

  it('spends no round trip on a list it has nothing to write to', async () => {
    const { service, tx } = buildService();

    await service.importBoard(WORKSPACE_ID, ACTOR_ID, fixtureBytes('edge-empty-board'));

    expect(tx.board.create).toHaveBeenCalledTimes(1);
    expect(tx.column.createMany).not.toHaveBeenCalled();
    expect(tx.task.createMany).not.toHaveBeenCalled();
    expect(tx.attachment.createMany).not.toHaveBeenCalled();
  });

  it('does not open a transaction for a file that is not a Trello export', async () => {
    const { service, prisma } = buildService();

    await expect(
      service.importBoard(WORKSPACE_ID, ACTOR_ID, fixtureBytes('edge-truncated')),
    ).rejects.toThrow(BadRequestException);

    // Reading happens before the transaction, so a bad file costs no connection at all.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('carries a drifted export across and still writes a board', async () => {
    const { service, tx } = buildService();

    const report = await service.importBoard(
      WORKSPACE_ID,
      ACTOR_ID,
      fixtureBytes('edge-unknown-shape'),
    );

    // The whole reason the reader reports instead of throwing: an export whose shape this
    // repository got wrong still produces a board, plus a report of what was lost.
    expect(tx.board.create).toHaveBeenCalledTimes(1);
    expect(report.skipped.length).toBeGreaterThan(0);
  });

  it('gives two imports of the same file two boards', async () => {
    const { service } = buildService();
    const bytes = fixtureBytes('synthetic-full-board');

    const first = await service.importBoard(WORKSPACE_ID, ACTOR_ID, bytes);
    const second = await service.importBoard(WORKSPACE_ID, ACTOR_ID, bytes);

    // ADR 0025 decided against idempotency rather than forgot about it. Nailed here so it cannot
    // drift into an accident.
    expect(first.boardId).not.toBe(second.boardId);
    expect(second.imported).toEqual(first.imported);
  });
});
