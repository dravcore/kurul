import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';
import { App } from 'supertest/types';
import {
  ActivityType,
  AttachmentKind,
  AUDIT_ACTIVITY_TYPES,
  ColumnCategory,
  MemberRole,
  TrelloImportScope,
  TrelloImportSkipReason,
} from '@kurultay/shared-types';
import type { TrelloImportReportDto, TrelloImportSkipGroupDto } from '@kurultay/shared-types';
import { SKIP_SAMPLE_LIMIT } from '../src/import/import-skip';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { addMember, createWorkspace, signUp, type TestUser } from './helpers/auth';
import { resetDatabase } from './helpers/db';

/**
 * The Trello importer, through the assembled application.
 *
 * The unit specs beside `src/import/*` already pin what the reader, the planner and the collector
 * each decide in isolation, against inputs those files construct. This file exists for the
 * questions only a running stack can answer: which status code a guard produces, which one a
 * multipart limit produces, and — the one this suite cares about most — whether the report the
 * user is shown agrees with the rows that are actually in the database. A planner counter that
 * drifts from the writer would show up nowhere else, and it would show up to the user as a number
 * that looks right.
 *
 * ## The ceiling this suite runs under
 *
 * `TRELLO_IMPORT_MAX_BYTES` is resolved by `MulterModule.registerAsync`'s factory when
 * `ImportModule` is instantiated, so setting it before `createTestApp()` gives this whole file a
 * 64 KiB ceiling and lets the size-limit rows be three requests that differ by one byte instead of
 * three 20 MiB uploads. The *production* number is checked against the proxy contract by
 * `src/storage/two-layer-limit.spec.ts`; what is checked here is the behaviour of whatever number
 * is configured. The variable is put back in `afterAll` — the e2e run shares one process
 * (`--runInBand`) and `config.e2e-spec.ts` asserts the unconfigured state.
 *
 * ## What this suite deliberately does not cover
 *
 * **The 3/min rate limit.** `test/setup-e2e.ts` sets `RATE_LIMIT_ENABLED=false` for the whole
 * integration run, because these specs drive hundreds of requests from one loopback address. The
 * ceiling itself is asserted from the route metadata in `src/import/import.controller.spec.ts`,
 * which is where a dropped `@ThrottleImport()` is caught.
 *
 * **Schema fidelity.** Every fixture here was written in this repository from memory of Trello's
 * format (`test/fixtures/trello/README.md`). A green run says the importer handles what we believe
 * a Trello export looks like, and nothing at all about what Trello actually writes.
 */

const MAX_BYTES = 64 * 1024;

const FIXTURES = join(__dirname, 'fixtures', 'trello');

function fixturePath(name: string): string {
  return join(FIXTURES, `${name}.json`);
}

/**
 * A *valid* export of exactly `size` bytes, padded in `desc`.
 *
 * `Buffer.alloc(size)` would have been shorter and would have measured nothing: a buffer of zeroes
 * is not JSON, so every row of the size table would answer 400 whether or not a limit existed, and
 * the test would be pinning the parser rather than the ceiling. Padding a real export means the
 * only thing separating a 201 from a 413 is the byte count. `a` is one UTF-8 byte and needs no
 * JSON escaping, so the serialised length is the length this function was asked for — asserted
 * below rather than assumed, because an off-by-one in the padding would quietly move the very
 * boundary the table exists to locate.
 */
function paddedExport(size: number): Buffer {
  const skeleton = {
    name: 'Padded',
    desc: '',
    lists: [],
    cards: [],
    labels: [],
    checklists: [],
    members: [],
    actions: [],
  };
  const overhead = Buffer.byteLength(JSON.stringify(skeleton), 'utf8');
  if (size < overhead) throw new Error(`cannot build an export smaller than ${overhead} bytes`);
  skeleton.desc = 'a'.repeat(size - overhead);
  const bytes = Buffer.from(JSON.stringify(skeleton), 'utf8');
  if (bytes.byteLength !== size) {
    throw new Error(`padding produced ${bytes.byteLength} bytes, wanted ${size}`);
  }
  return bytes;
}

/** An export whose only content is `count` archived cards — one skip group, `count` items in it. */
function archivedCardExport(count: number): Buffer {
  const listId = '6512a1b1c3d4e5f601020310';
  return Buffer.from(
    JSON.stringify({
      name: 'Archive heavy',
      desc: '',
      lists: [{ id: listId, name: 'Backlog', closed: false, pos: 16384 }],
      cards: Array.from({ length: count }, (_, index) => ({
        id: `6512a1b3c3d4e5f6010204${String(index).padStart(2, '0')}`,
        name: `Archived card ${index + 1}`,
        desc: '',
        closed: true,
        due: null,
        idList: listId,
        idLabels: [],
        idMembers: [],
        pos: (index + 1) * 1024,
        attachments: [],
      })),
      labels: [],
      checklists: [],
      members: [],
      actions: [],
    }),
    'utf8',
  );
}

function groupFor(
  report: TrelloImportReportDto,
  scope: TrelloImportScope,
  reason: TrelloImportSkipReason,
): TrelloImportSkipGroupDto | undefined {
  return report.skipped.find((group) => group.scope === scope && group.reason === reason);
}

/**
 * The hosts a set of `http.request` / `https.request` calls was aimed at.
 *
 * Typed against the shape rather than `jest.SpyInstance` because `http.request` is overloaded and
 * the recorded argument tuple is only knowable at runtime.
 */
function requestHosts(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((args) => {
    const first = args[0];
    if (typeof first === 'string') return new URL(first).hostname;
    if (first instanceof URL) return first.hostname;
    if (typeof first === 'object' && first !== null) {
      const options = first as { hostname?: unknown; host?: unknown };
      if (typeof options.hostname === 'string') return options.hostname;
      if (typeof options.host === 'string') return options.host.split(':')[0] ?? '';
    }
    return '';
  });
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '']);

describe('Trello import (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let previousMaxBytes: string | undefined;

  let admin: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let outsiderWorkspaceId: string;

  beforeAll(async () => {
    previousMaxBytes = process.env.TRELLO_IMPORT_MAX_BYTES;
    process.env.TRELLO_IMPORT_MAX_BYTES = String(MAX_BYTES);
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    if (previousMaxBytes === undefined) delete process.env.TRELLO_IMPORT_MAX_BYTES;
    else process.env.TRELLO_IMPORT_MAX_BYTES = previousMaxBytes;
  });

  beforeEach(async () => {
    await resetDatabase(prisma);

    admin = await signUp(app, { name: 'Import Admin' });
    member = await signUp(app, { name: 'Import Member' });
    outsider = await signUp(app, { name: 'Outsider' });

    const workspace = await createWorkspace(admin.agent, 'Import', 'import');
    workspaceId = workspace.id;
    const outsiderWorkspace = await createWorkspace(outsider.agent, 'Theirs', 'theirs');
    outsiderWorkspaceId = outsiderWorkspace.id;

    const me = await member.agent.get('/me').expect(200);
    await addMember(prisma, workspaceId, me.body.id as string, MemberRole.MEMBER);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function importUrl(id: string): string {
    return `/workspaces/${id}/imports/trello`;
  }

  async function importFixture(user: TestUser, name: string): Promise<TrelloImportReportDto> {
    const response = await user.agent
      .post(importUrl(workspaceId))
      .attach('file', fixturePath(name), 'trello.json');
    expect(response.status).toBe(201);
    return response.body as TrelloImportReportDto;
  }

  // ---------------------------------------------------------------------------------------
  // Tenant scope and role
  // ---------------------------------------------------------------------------------------

  describe('who may import', () => {
    it('accepts an ADMIN — the control every refusal below is measured against', async () => {
      const response = await admin.agent
        .post(importUrl(workspaceId))
        .attach('file', fixturePath('synthetic-full-board'), 'trello.json');

      expect(response.status).toBe(201);
      expect(await prisma.board.count({ where: { workspaceId } })).toBe(1);
    });

    it('refuses a MEMBER with 403, because the import creates columns', async () => {
      const before = await prisma.board.count();

      const response = await member.agent
        .post(importUrl(workspaceId))
        .attach('file', fixturePath('synthetic-full-board'), 'trello.json');

      // 403, not 404: the caller *is* a member, so nothing is being hidden from them — what is
      // refused is the role. The two codes come from two guards (`WorkspaceGuard` then
      // `RolesGuard`), and telling them apart is the point of having both assertions in this file.
      expect(response.status).toBe(403);
      // The second assertion, and it is the one that survives a widened guard: a test that only
      // reads the status cannot tell "the role was refused" from "the request was refused and
      // half a board was written first".
      expect(await prisma.board.count()).toBe(before);
    });

    it('refuses a non-member with 404, leaking nothing about the workspace', async () => {
      const before = await prisma.board.count();

      const response = await admin.agent
        .post(importUrl(outsiderWorkspaceId))
        .attach('file', fixturePath('synthetic-full-board'), 'trello.json');

      // 404 rather than 403 — `docs/api-conventions.md`. A 403 here would confirm the workspace
      // exists to someone who is not in it.
      expect(response.status).toBe(404);
      expect(await prisma.board.count()).toBe(before);
      expect(await prisma.board.count({ where: { workspaceId: outsiderWorkspaceId } })).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------
  // The board that comes out, and the report that describes it
  // ---------------------------------------------------------------------------------------

  describe('an ordinary board', () => {
    it('writes the whole board while reporting everything it left behind', async () => {
      const source = JSON.parse(readFileSync(fixturePath('synthetic-full-board'), 'utf8')) as {
        lists: { closed: boolean }[];
        cards: { closed: boolean; name: string }[];
        labels: unknown[];
      };

      const report = await importFixture(admin, 'synthetic-full-board');

      const board = await prisma.board.findUniqueOrThrow({
        where: { id: report.boardId },
        include: {
          columns: true,
          labels: true,
          tasks: {
            include: { checklists: { include: { items: true } }, attachments: true, labels: true },
          },
        },
      });

      expect(board.workspaceId).toBe(workspaceId);
      expect(board.name).toBe('Product Roadmap');

      // ## The board is complete — the *coverage* is what is partial (ADR 0025)
      const liveLists = source.lists.filter((list) => !list.closed).length;
      expect(board.columns).toHaveLength(liveLists);
      expect(board.labels).toHaveLength(source.labels.length);
      // Four of the six cards: one is archived, one has no name. Written out rather than derived
      // from the file, because deriving the expectation from the same rule the planner applies
      // would make this assertion agree with the planner by construction.
      expect(board.tasks).toHaveLength(4);

      const checklists = board.tasks.flatMap((task) => task.checklists);
      expect(checklists).toHaveLength(3);
      expect(checklists.flatMap((checklist) => checklist.items)).toHaveLength(5);
      expect(checklists.flatMap((c) => c.items).filter((item) => item.isDone)).toHaveLength(2);

      // Every column takes the schema default; ADR 0019 refuses to infer a category from a name
      // or a position, and a Trello export offers nothing else.
      expect(board.columns.every((column) => column.category === ColumnCategory.UNSTARTED)).toBe(
        true,
      );

      // Positions are ours, not Trello's — the file's `pos` values are 16384/32768/65535.
      expect(board.columns.map((column) => column.position).sort((a, b) => a - b)).toEqual([
        1000, 2000, 3000,
      ]);
      expect(
        [...board.columns].sort((a, b) => a.position - b.position).map((column) => column.name),
      ).toEqual(['Backlog', 'In Progress', 'Shipped']);

      // Colour is a slot, never a hex. The one rule CLAUDE.md states about this column.
      expect(board.labels.every((label) => /^slot-[1-8]$/.test(label.color))).toBe(true);

      // Attachments came across as links and nothing was stored.
      const attachments = board.tasks.flatMap((task) => task.attachments);
      expect(attachments).toHaveLength(2);
      for (const attachment of attachments) {
        expect(attachment.kind).toBe(AttachmentKind.Link);
        expect(attachment.storageKey).toBeNull();
        expect(attachment.size).toBeNull();
        expect(attachment.mimeType).toBeNull();
        expect(attachment.url).toMatch(/^https?:/);
      }

      // ## The report does not lie about any of it
      //
      // The most valuable pair of lines in this file. The report is the only place a user ever
      // sees these numbers, and nothing else compares the planner's counters with the rows the
      // transaction actually wrote.
      expect(report.imported).toEqual({
        columns: board.columns.length,
        tasks: board.tasks.length,
        labels: board.labels.length,
        checklists: checklists.length,
        checklistItems: checklists.flatMap((checklist) => checklist.items).length,
        attachments: attachments.length,
      });

      // ## And the skipped half is populated, group by group
      expect(groupFor(report, TrelloImportScope.List, TrelloImportSkipReason.Archived)).toEqual({
        scope: TrelloImportScope.List,
        reason: TrelloImportSkipReason.Archived,
        count: 1,
        samples: ['Old Sprint'],
      });
      expect(groupFor(report, TrelloImportScope.Card, TrelloImportSkipReason.Archived)?.count).toBe(
        1,
      );
      expect(
        groupFor(report, TrelloImportScope.Card, TrelloImportSkipReason.Malformed)?.count,
      ).toBe(1);
      // Every imported column is waiting for a human to pick its category.
      expect(
        groupFor(report, TrelloImportScope.Column, TrelloImportSkipReason.Defaulted)?.count,
      ).toBe(board.columns.length);
      expect(
        groupFor(report, TrelloImportScope.Label, TrelloImportSkipReason.Defaulted)?.count,
      ).toBe(3);
      // The `file:` attachment. Told apart from a typo'd URL on purpose — this is the K7 case.
      expect(
        groupFor(report, TrelloImportScope.Attachment, TrelloImportSkipReason.UnsupportedScheme),
      ).toEqual({
        scope: TrelloImportScope.Attachment,
        reason: TrelloImportSkipReason.UnsupportedScheme,
        count: 1,
        samples: ['Local spec copy'],
      });
      expect(
        groupFor(report, TrelloImportScope.Member, TrelloImportSkipReason.Unmappable)?.count,
      ).toBe(2);
      // Two of the three `actions[]` entries are comments; the third is an `updateCard`.
      expect(
        groupFor(report, TrelloImportScope.Comment, TrelloImportSkipReason.OutOfScope)?.count,
      ).toBe(2);
    });

    it('carries no member across, and stamps every row with the importer', async () => {
      const me = await admin.agent.get('/me').expect(200);
      const actorId = me.body.id as string;

      const report = await importFixture(admin, 'synthetic-full-board');

      const tasks = await prisma.task.findMany({ where: { boardId: report.boardId } });
      expect(tasks.every((task) => task.createdById === actorId)).toBe(true);
      const attachments = await prisma.attachment.findMany({
        where: { task: { boardId: report.boardId } },
      });
      expect(attachments.every((row) => row.uploadedById === actorId)).toBe(true);
      // K5: a Trello member is not a Kurultay user, so nothing was assigned to anybody.
      expect(await prisma.taskAssignee.count()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------
  // Report arithmetic
  // ---------------------------------------------------------------------------------------

  describe('report arithmetic', () => {
    const ARCHIVED = SKIP_SAMPLE_LIMIT + 5;

    it('caps the samples and never the count', async () => {
      const response = await admin.agent
        .post(importUrl(workspaceId))
        .attach('file', archivedCardExport(ARCHIVED), 'trello.json');
      expect(response.status).toBe(201);
      const report = response.body as TrelloImportReportDto;

      const group = groupFor(report, TrelloImportScope.Card, TrelloImportSkipReason.Archived);
      // `count` is the real number, and the arrangement of this fixture is what makes that
      // assertion mean something: with `ARCHIVED` above the sample limit, a `count` that was
      // capped alongside the samples would read 20 here.
      expect(group?.count).toBe(ARCHIVED);
      expect(ARCHIVED).toBeGreaterThan(SKIP_SAMPLE_LIMIT);
      expect(group?.samples).toHaveLength(SKIP_SAMPLE_LIMIT);
      // Samples are names, not placeholders, and they are the *first* ones — a cap that kept the
      // tail would be a different (and worse) report.
      expect(group?.samples[0]).toBe('Archived card 1');

      // And the independent half: the count describes rows that are genuinely not there.
      expect(await prisma.task.count({ where: { boardId: report.boardId } })).toBe(0);
      expect(report.imported.tasks).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------
  // The size limit
  // ---------------------------------------------------------------------------------------

  describe('the body limit', () => {
    it.each([
      ['one byte under the limit', MAX_BYTES - 1, 201],
      // busboy fires its limit on equality, which is what the `+ 1` in `import.module.ts` buys.
      ['exactly at the limit', MAX_BYTES, 201],
      ['one byte over the limit', MAX_BYTES + 1, 413],
    ])('answers %s (%i bytes) with %i', async (_name, size, expected) => {
      const response = await admin.agent
        .post(importUrl(workspaceId))
        .attach('file', paddedExport(size), 'trello.json');

      expect(response.status).toBe(expected);
    });

    it('writes nothing when the body is refused', async () => {
      const before = await prisma.board.count();

      await admin.agent
        .post(importUrl(workspaceId))
        .attach('file', paddedExport(MAX_BYTES + 1), 'trello.json')
        .expect(413);

      expect(await prisma.board.count()).toBe(before);
    });
  });

  // ---------------------------------------------------------------------------------------
  // Bodies the importer refuses to read
  // ---------------------------------------------------------------------------------------

  describe('unreadable bodies', () => {
    it('answers 400 for a truncated export, and writes nothing', async () => {
      const before = await prisma.board.count();

      const response = await admin.agent
        .post(importUrl(workspaceId))
        .attach('file', fixturePath('edge-truncated'), 'trello.json');

      expect(response.status).toBe(400);
      expect(await prisma.board.count()).toBe(before);
    });

    it('answers 400 for JSON that is not a board export', async () => {
      // Trello's *card* export: valid JSON, has a `name`, has no `lists`. People upload it.
      const response = await admin.agent
        .post(importUrl(workspaceId))
        .attach('file', fixturePath('edge-card-export'), 'trello.json');

      expect(response.status).toBe(400);
      expect(await prisma.board.count()).toBe(0);
    });

    it('answers 400 when no file part was sent at all', async () => {
      // `FileInterceptor` is a no-op on a request that is not multipart, so this reaches the
      // handler with no file rather than being rejected by multer.
      const response = await admin.agent.post(importUrl(workspaceId));

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/file part named/);
    });

    it('answers 400 when the file part is under the wrong name', async () => {
      const response = await admin.agent
        .post(importUrl(workspaceId))
        .attach('export', fixturePath('synthetic-full-board'), 'trello.json');

      expect(response.status).toBe(400);
      expect(await prisma.board.count()).toBe(0);
    });

    it('imports what it can read and reports the rest, rather than failing', async () => {
      // The negative control for the four refusals above. Without it, "the importer answers 400"
      // would still pass if it answered 400 for *everything* — including the schema drift the
      // reader exists to survive.
      const report = await importFixture(admin, 'edge-unknown-shape');

      expect(report.boardId).toEqual(expect.any(String));
      expect(report.skipped.length).toBeGreaterThan(0);
      expect(await prisma.board.count({ where: { workspaceId } })).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------
  // D9 — no idempotency, on purpose
  // ---------------------------------------------------------------------------------------

  describe('importing the same export twice', () => {
    it('creates a second board, with twice the cards', async () => {
      const first = await importFixture(admin, 'synthetic-full-board');
      const second = await importFixture(admin, 'synthetic-full-board');

      // This test confirms a behaviour rather than catching a fault, and that is deliberate: ADR
      // 0025 rejected idempotency, and a rejected decision only stays a decision while something
      // holds it still. Whoever adds "do not import the same board twice" turns this red and has
      // to read the ADR before deleting it.
      expect(second.boardId).not.toBe(first.boardId);
      expect(await prisma.board.count({ where: { workspaceId } })).toBe(2);
      expect(await prisma.task.count({ where: { board: { workspaceId } } })).toBe(
        first.imported.tasks * 2,
      );
      expect(second.imported).toEqual(first.imported);
      expect(second.skipped).toEqual(first.skipped);
    });
  });

  // ---------------------------------------------------------------------------------------
  // K7 — the server never asks Trello for anything
  // ---------------------------------------------------------------------------------------

  describe('outbound requests', () => {
    it('never fetches an imported attachment URL', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch');
      const httpSpy = jest.spyOn(http, 'request');
      const httpsSpy = jest.spyOn(https, 'request');

      // ## Prove the instrumentation before trusting the silence
      //
      // Without this block the assertions below pass on a spy that was never attached to anything
      // — the shape of "passing test that proves nothing" this whole exercise is written against.
      await expect(fetch('http://127.0.0.1:1/probe')).rejects.toThrow();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const probe = https.request('https://example.invalid/probe');
      probe.on('error', () => {});
      probe.destroy();
      expect(requestHosts(httpsSpy)).toContain('example.invalid');

      fetchSpy.mockClear();
      httpSpy.mockClear();
      httpsSpy.mockClear();

      // The fixture's attachments point at `example.invalid` and `trello.com`.
      const report = await importFixture(admin, 'synthetic-full-board');
      const urls = (
        await prisma.attachment.findMany({
          where: { task: { boardId: report.boardId } },
          select: { url: true },
        })
      ).map((row) => row.url ?? '');
      expect(urls.some((url) => url.includes('trello.com'))).toBe(true);

      // `fetch` is the API this repository would reach for, so it is checked as a count.
      expect(fetchSpy).not.toHaveBeenCalled();
      // And the lower-level door, because a "fetch a preview" step could just as easily be an
      // `https.get`. Loopback is filtered out rather than asserted away: supertest's own request
      // to this app goes through `http.request`, and it is not an outbound call.
      const remote = [...requestHosts(httpSpy), ...requestHosts(httpsSpy)].filter(
        (host) => !LOOPBACK.has(host),
      );
      expect(remote).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------
  // D7 — exactly one activity row, and it is auditable
  // ---------------------------------------------------------------------------------------

  describe('the activity trail', () => {
    it('records one complete board.imported row and nothing per card', async () => {
      const me = await admin.agent.get('/me').expect(200);
      const actorId = me.body.id as string;
      const before = await prisma.activity.count({ where: { workspaceId } });

      const report = await importFixture(admin, 'synthetic-full-board');

      const rows = await prisma.activity.findMany({ where: { workspaceId } });
      // One row, not one per card. "500 cards were created" told with 500 rows splits one event
      // into 500, which is the volume ADR 0024 names as the thing that may not enter the audit
      // subset — and this import wrote four cards, five checklist items and two links.
      expect(rows).toHaveLength(before + 1);

      const imported = rows.find((row) => row.type === ActivityType.BoardImported);
      expect(imported).toBeDefined();
      expect(imported?.userId).toBe(actorId);
      // The whole payload, not a subset: a truncated payload is how an activity row stops being
      // an answer to "what happened here".
      expect(imported?.payload).toEqual({
        boardId: report.boardId,
        name: 'Product Roadmap',
        source: 'trello',
        imported: report.imported,
        skippedTotal: report.skipped.reduce((total, group) => total + group.count, 0),
      });
      expect(report.skipped.reduce((total, group) => total + group.count, 0)).toBeGreaterThan(0);
    });

    it('shows up in the audit query an incident responder would run', async () => {
      const report = await importFixture(admin, 'synthetic-full-board');

      // The same single statement `audit-trail.e2e-spec.ts` uses: one workspace, `type IN (…)`.
      // `board.imported` is in `AUDIT_ACTIVITY_TYPES` because creating a board is structural
      // administration however the button was labelled — take it out of that list and this
      // returns nothing.
      const trail = await prisma.activity.findMany({
        where: { workspaceId, type: { in: [...AUDIT_ACTIVITY_TYPES] } },
        orderBy: { id: 'desc' },
      });

      expect(trail.map((row) => row.type)).toContain(ActivityType.BoardImported);
      expect(
        (
          trail.find((row) => row.type === ActivityType.BoardImported)?.payload as {
            boardId: string;
          }
        ).boardId,
      ).toBe(report.boardId);
    });
  });
});
