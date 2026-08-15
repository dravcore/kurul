import { INestApplication } from '@nestjs/common';
import { readdir, stat, utimes } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { Readable } from 'node:stream';
import { crc32, deflateSync } from 'node:zlib';
import { App } from 'supertest/types';
import {
  ActivityType,
  AttachmentKind,
  AUDIT_ACTIVITY_TYPES,
  MemberRole,
  SocketEvents,
} from '@kurultay/shared-types';
import type { AttachmentDto } from '@kurultay/shared-types';
import { PrismaService } from '../src/prisma/prisma.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { CleanupWorker, orphanGraceMs } from '../src/retention/cleanup.worker';
import { closeStorageBackend } from '../src/storage/storage';
import { StorageService } from '../src/storage/storage.service';
import { createTestApp } from './helpers/app';
import { addMember, createWorkspace, signUp, TestUser } from './helpers/auth';
import { resetDatabase } from './helpers/db';
import { createTempStorageDir, removeTempStorageDir } from './helpers/storage';

/**
 * The verification table of phase plan §4.1b, against the real stack.
 *
 * Everything here is measured through a socket: a real Postgres, a real directory on a real
 * filesystem (ADR 0022 rejected a memory backend), real multipart bodies parsed by the real
 * multer configuration, and the real `CleanupWorker`. The unit specs beside each source file
 * already pin what each collaborator is *asked* to do; this file exists for the questions only an
 * assembled application can answer — which status code a limit produces, which headers reach the
 * wire, and whether the bytes are where the row says they are.
 *
 * ## The ceiling this suite runs under
 *
 * `ATTACHMENT_MAX_BYTES` is resolved when `AttachmentModule` is instantiated (plan decision D5),
 * so setting it before `createTestApp()` gives the whole file a 64 KiB ceiling and the size-limit
 * test a 64 KiB buffer instead of a 25 MiB one. The production number is checked against the
 * proxy contract by `src/storage/two-layer-limit.spec.ts`; what is checked here is the
 * *behaviour* of whatever number is configured.
 *
 * `STORAGE_PATH` is set the same way and for the same reason: the backend is a process-wide
 * singleton, so it is dropped with `closeStorageBackend()` on both sides of the suite and the
 * environment is put back — the e2e run shares one process (`--runInBand`) and `config.e2e-spec`
 * asserts the *unconfigured* state.
 */

const MAX_BYTES = 64 * 1024;

/** A genuine 1x1 greyscale PNG, assembled here rather than checked in as an opaque blob. */
function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([header, data, crc]);
}

function buildPng(): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(0, 9); // colour type: greyscale
  // compression, filter and interlace all stay 0 — the only values the format defines.
  // One scanline: the filter byte, then the single pixel.
  const idat = deflateSync(Buffer.from([0x00, 0x00]));
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const PNG = buildPng();

/**
 * A PNG of exactly `size` bytes.
 *
 * Padding goes *after* `IEND`, where a decoder stops reading and where `file-type` — which reads
 * the eight-byte signature at the front — is unaffected. That is what makes the pair of size-limit
 * tests differ in one byte and nothing else: both are real PNGs, so the only thing that can
 * separate a 201 from a 413 is the limit itself. A buffer of zeros would have answered 415
 * whether or not a limit existed, which is a passing test that proves nothing.
 */
function pngOfSize(size: number): Buffer {
  if (size < PNG.length) throw new Error(`cannot build a PNG smaller than ${PNG.length} bytes`);
  return Buffer.concat([PNG, Buffer.alloc(size - PNG.length, 0x20)]);
}

/** A small but genuine PDF — `file-type` reads the `%PDF-` header. */
const PDF = Buffer.from(
  '%PDF-1.7\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n' +
    'trailer<</Root 1 0 R>>\n' +
    '%%EOF\n',
  'ascii',
);

const HTML = Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8');
const CSV = Buffer.from('name,role\nKurultay,kanban\n', 'utf8');

/** Collects a binary response body superagent would otherwise decode as text. */
function binaryParser(
  res: NodeJS.ReadableStream,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', (error: Error) => callback(error, Buffer.alloc(0)));
}

interface Seed {
  user: TestUser;
  userId: string;
  workspaceId: string;
  boardId: string;
  taskId: string;
}

describe('Attachments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let realtime: RealtimeService;
  let storage: StorageService;
  let cleanup: CleanupWorker;
  let storageRoot: string;
  let previousStoragePath: string | undefined;
  let previousMaxBytes: string | undefined;

  beforeAll(async () => {
    storageRoot = await createTempStorageDir();
    previousStoragePath = process.env.STORAGE_PATH;
    previousMaxBytes = process.env.ATTACHMENT_MAX_BYTES;
    process.env.STORAGE_PATH = storageRoot;
    process.env.ATTACHMENT_MAX_BYTES = String(MAX_BYTES);
    // Drop the singleton so the values above are the ones the app reads.
    await closeStorageBackend();

    app = await createTestApp();
    prisma = app.get(PrismaService);
    realtime = app.get(RealtimeService);
    storage = app.get(StorageService);
    cleanup = app.get(CleanupWorker);
    // One JSON line per sweep; the line's shape is asserted in the unit spec.
    cleanup.setLogWriter(() => {});
  });

  afterAll(async () => {
    await app.close();
    if (previousStoragePath === undefined) delete process.env.STORAGE_PATH;
    else process.env.STORAGE_PATH = previousStoragePath;
    if (previousMaxBytes === undefined) delete process.env.ATTACHMENT_MAX_BYTES;
    else process.env.ATTACHMENT_MAX_BYTES = previousMaxBytes;
    await closeStorageBackend();
    await removeTempStorageDir(storageRoot);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    // The storage root is this spec's own state, exactly as the database is (docs/testing.md).
    for (const entry of await readdir(storageRoot)) {
      await removeTempStorageDir(join(storageRoot, entry));
    }
    jest.restoreAllMocks();
  });

  afterEach(() => {
    process.env.CLEANUP_ENABLED = 'false';
  });

  async function seed(label = 'files'): Promise<Seed> {
    const user = await signUp(app, { name: 'Attachment Owner' });
    const workspace = await createWorkspace(user.agent, 'Attachments', label);
    const me = await user.agent.get('/me').expect(200);
    const board = await user.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Board' })
      .expect(201);
    const columns = await user.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
      .expect(200);
    const task = await user.agent
      .post(`/workspaces/${workspace.id}/boards/${board.body.id}/tasks`)
      .send({ title: 'Card', columnId: columns.body[0].id })
      .expect(201);

    return {
      user,
      userId: me.body.id as string,
      workspaceId: workspace.id,
      boardId: board.body.id as string,
      taskId: task.body.id as string,
    };
  }

  async function upload(
    where: Seed,
    bytes: Buffer,
    filename: string,
    contentType: string,
  ): Promise<AttachmentDto> {
    const response = await where.user.agent
      .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
      .field('kind', AttachmentKind.File)
      .attach('file', bytes, { filename, contentType })
      .expect(201);
    return response.body as AttachmentDto;
  }

  /** Every stored file, as a path relative to the storage root, with `/` separators. */
  async function listStorageFiles(): Promise<string[]> {
    const entries = await readdir(storageRoot, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .map((absolute) =>
        absolute
          .slice(storageRoot.length + 1)
          .split(sep)
          .join('/'),
      )
      .sort();
  }

  async function storageFileExists(key: string): Promise<boolean> {
    return stat(join(storageRoot, ...key.split('/'))).then(
      () => true,
      () => false,
    );
  }

  /** Backdates a stored file, the way `tar -xzf` backdates every file it restores. */
  async function ageStorageFile(key: string, at: number): Promise<void> {
    const absolute = join(storageRoot, ...key.split('/'));
    await utimes(absolute, new Date(at), new Date(at));
  }

  async function storageKeyOf(attachmentId: string): Promise<string> {
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
    if (row.storageKey === null) throw new Error('attachment has no storage key');
    return row.storageKey;
  }

  async function sweep(): Promise<Awaited<ReturnType<CleanupWorker['runCleanup']>>> {
    process.env.CLEANUP_ENABLED = 'true';
    try {
      return await cleanup.runCleanup();
    } finally {
      process.env.CLEANUP_ENABLED = 'false';
    }
  }

  describe('tenant scope', () => {
    it("hides another workspace's attachment behind a 404, not a 403, and changes nothing", async () => {
      const mine = await seed('mine');
      const theirs = await seed('theirs');
      const foreign = await upload(theirs, PNG, 'theirs.png', 'image/png');
      const foreignKey = await storageKeyOf(foreign.id);

      // 404 rather than 403 throughout: a 403 confirms the row exists, which is the one thing a
      // cross-tenant probe is trying to learn (`common/guards/workspace.guard.ts`).
      //
      // The clause this nails is `requireAttachment`'s — remove
      // `task: { board: { workspaceId } }` from it and all three answer 200/200/204. The
      // relation predicate on `remove`'s `deleteMany` is a second layer that this test cannot
      // reach (the read has already thrown), which is why `attachment.service.spec.ts` asserts
      // that `where` by exact match instead.
      await mine.user.agent
        .get(`/workspaces/${mine.workspaceId}/attachments/${foreign.id}`)
        .expect(404);
      await mine.user.agent
        .get(`/workspaces/${mine.workspaceId}/attachments/${foreign.id}/content`)
        .expect(404);
      await mine.user.agent
        .delete(`/workspaces/${mine.workspaceId}/attachments/${foreign.id}`)
        .expect(404);

      // The row and the bytes both survived — a 404 that still deleted would be a passing test
      // and an unfixed finding.
      await expect(
        prisma.attachment.findUnique({ where: { id: foreign.id } }),
      ).resolves.not.toBeNull();
      await expect(storageFileExists(foreignKey)).resolves.toBe(true);
    });

    it('answers all three for the owning workspace, so the 404s above are about scope', async () => {
      // The control. Without it, three 404s from routes broken for an unrelated reason would
      // read as proof of tenant isolation.
      const theirs = await seed('control');
      const own = await upload(theirs, PNG, 'own.png', 'image/png');

      await theirs.user.agent
        .get(`/workspaces/${theirs.workspaceId}/attachments/${own.id}`)
        .expect(200);
      await theirs.user.agent
        .get(`/workspaces/${theirs.workspaceId}/attachments/${own.id}/content`)
        .expect(200);
      await theirs.user.agent
        .delete(`/workspaces/${theirs.workspaceId}/attachments/${own.id}`)
        .expect(204);
    });

    /**
     * The other half of the tenant scope, and the half nothing covered until this review.
     *
     * Every test above puts the *requester’s own* workspace id in the path, so what they
     * nail is `requireAttachment`'s `where` clause — the predicate that refuses a row
     * belonging to somebody else. That clause cannot help here: an outsider who writes the
     * *owning* workspace's id into the path is asking for a row that really does live there,
     * and the `where` matches. The only thing standing between them and the bytes is
     * `@WorkspaceScoped()`, whose `WorkspaceGuard` answers 404 for a non-member.
     *
     * Measured: deleting `@WorkspaceScoped()` from the byte-stream route left all 34 tests in
     * this file green, and the endpoint served any attachment on the instance to any signed-in
     * user who knew two ids. That is what this test now costs.
     */
    it('refuses a non-member who addresses the owning workspace directly', async () => {
      const theirs = await seed('outsider-owner');
      const created = await upload(theirs, PNG, 'theirs.png', 'image/png');
      const outsider = await signUp(app, { name: 'Outsider' });

      // The outsider is a member of no workspace at all — the plainest form of the question.
      await outsider.agent
        .get(`/workspaces/${theirs.workspaceId}/tasks/${theirs.taskId}/attachments`)
        .expect(404);
      await outsider.agent
        .get(`/workspaces/${theirs.workspaceId}/attachments/${created.id}`)
        .expect(404);
      await outsider.agent
        .get(`/workspaces/${theirs.workspaceId}/attachments/${created.id}/content`)
        .expect(404);
      await outsider.agent
        .delete(`/workspaces/${theirs.workspaceId}/attachments/${created.id}`)
        .expect(404);

      // Nothing was removed on the way past.
      await expect(
        prisma.attachment.findUnique({ where: { id: created.id } }),
      ).resolves.not.toBeNull();
    });

    /**
     * The same question asked by somebody who *is* a member somewhere, because "member of no
     * workspace" is a state a real attacker never has to be in — and because a guard that
     * looked up membership without comparing the workspace would pass the test above.
     */
    it('refuses a member of another workspace who addresses the owning one directly', async () => {
      const theirs = await seed('outsider-scoped-owner');
      const mine = await seed('outsider-scoped-mine');
      const created = await upload(theirs, PNG, 'theirs.png', 'image/png');

      await mine.user.agent
        .get(`/workspaces/${theirs.workspaceId}/attachments/${created.id}/content`)
        .expect(404);
    });
    it("hides an attachment on another workspace's task from the list endpoint too", async () => {
      const mine = await seed('list-mine');
      const theirs = await seed('list-theirs');
      await upload(theirs, PNG, 'theirs.png', 'image/png');

      await mine.user.agent
        .get(`/workspaces/${mine.workspaceId}/tasks/${theirs.taskId}/attachments`)
        .expect(404);
    });

    it('lets a GUEST read and refuses every write, while a MEMBER does both', async () => {
      const owner = await seed('roles');
      const created = await upload(owner, PNG, 'shared.png', 'image/png');

      const viewer = await signUp(app, { name: 'Guest' });
      const viewerMe = await viewer.agent.get('/me').expect(200);
      await addMember(prisma, owner.workspaceId, viewerMe.body.id as string, MemberRole.GUEST);

      const member = await signUp(app, { name: 'Member' });
      const memberMe = await member.agent.get('/me').expect(200);
      await addMember(prisma, owner.workspaceId, memberMe.body.id as string, MemberRole.MEMBER);

      await viewer.agent
        .get(`/workspaces/${owner.workspaceId}/tasks/${owner.taskId}/attachments`)
        .expect(200);
      await viewer.agent
        .get(`/workspaces/${owner.workspaceId}/attachments/${created.id}/content`)
        .expect(200);
      await viewer.agent
        .post(`/workspaces/${owner.workspaceId}/tasks/${owner.taskId}/attachments`)
        .field('kind', AttachmentKind.File)
        .attach('file', PNG, { filename: 'viewer.png', contentType: 'image/png' })
        .expect(403);
      await viewer.agent
        .delete(`/workspaces/${owner.workspaceId}/attachments/${created.id}`)
        .expect(403);

      const byMember = await member.agent
        .post(`/workspaces/${owner.workspaceId}/tasks/${owner.taskId}/attachments`)
        .field('kind', AttachmentKind.File)
        .attach('file', PNG, { filename: 'member.png', contentType: 'image/png' })
        .expect(201);
      await member.agent
        .delete(`/workspaces/${owner.workspaceId}/attachments/${byMember.body.id}`)
        .expect(204);
    });
  });

  describe('the size limit, at the API layer', () => {
    it('answers 413 one byte over the limit, and stores neither a row nor a file', async () => {
      const where = await seed('too-big');

      await where.user.agent
        .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
        .field('kind', AttachmentKind.File)
        .attach('file', pngOfSize(MAX_BYTES + 1), {
          filename: 'big.png',
          contentType: 'image/png',
        })
        .expect(413);

      await expect(prisma.attachment.count({ where: { taskId: where.taskId } })).resolves.toBe(0);
      await expect(listStorageFiles()).resolves.toEqual([]);
    });

    it('accepts the same PNG one byte under it', async () => {
      // The pair is the evidence. With `limits.fileSize` removed, this file and the one above
      // both answer 201; with it, two bytes separate 201 from 413 and nothing else differs.
      const where = await seed('just-fits');

      const created = await upload(where, pngOfSize(MAX_BYTES - 1), 'big.png', 'image/png');

      expect(created.size).toBe(MAX_BYTES - 1);
      await expect(prisma.attachment.count({ where: { taskId: where.taskId } })).resolves.toBe(1);
    });

    it('accepts a file of exactly ATTACHMENT_MAX_BYTES — the published ceiling is inclusive', async () => {
      // The boundary nail for K2, and the reason `attachment.module.ts` configures
      // `storage.maxBytes + 1`. busboy raises its limit on *equality*
      // (`busboy/lib/types/multipart.js:476`), so passing `maxBytes` straight through would
      // refuse a file of exactly the number both layers publish — while the proxy half passes
      // that same body (#215). That gap is a 413 nobody configured and nobody can trace, which
      // is the failure ADR 0022:170-176 exists to prevent.
      //
      // Remove the `+ 1` from the module and this is the one test that turns red.
      const where = await seed('exact');

      const created = await upload(where, pngOfSize(MAX_BYTES), 'exact.png', 'image/png');

      expect(created.size).toBe(MAX_BYTES);
      await expect(prisma.attachment.count()).resolves.toBe(1);
      await expect(listStorageFiles()).resolves.toHaveLength(1);
    });

    it('refuses a second file part rather than storing either', async () => {
      // `limits.files: 1` and not `single('file')`'s own `maxCount`: the two produce different
      // multer errors and only one of them is the limit. Without `limits.files`, busboy never
      // raises `filesLimit` and the wrapped fileFilter answers `Unexpected field - file`
      // instead (multer 2.2.0 `index.js:40`, `lib/make-middleware.js:254`).
      const where = await seed('two-files');

      const response = await where.user.agent
        .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
        .field('kind', AttachmentKind.File)
        .attach('file', PNG, { filename: 'one.png', contentType: 'image/png' })
        .attach('file', PNG, { filename: 'two.png', contentType: 'image/png' })
        .expect(400);

      expect(response.body.message).toContain('Too many files');
      await expect(prisma.attachment.count()).resolves.toBe(0);
      await expect(listStorageFiles()).resolves.toEqual([]);
    });

    it('refuses a ninth text field before the body is ever validated', async () => {
      const where = await seed('many-fields');

      const tooMany = where.user.agent
        .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
        .field('kind', AttachmentKind.File);
      for (let index = 0; index < 8; index += 1) tooMany.field(`extra${index}`, 'x');
      const refused = await tooMany.expect(400);

      expect(refused.body.message).toContain('Too many fields');

      // The control, and the reason the assertion above is about `limits.fields`: eight fields
      // reach the ValidationPipe, which rejects them for being unknown properties. Both answers
      // are 400, so without this the test would pass with no field limit configured at all.
      const withinLimit = where.user.agent
        .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
        .field('kind', AttachmentKind.File);
      for (let index = 0; index < 7; index += 1) withinLimit.field(`extra${index}`, 'x');
      const validated = await withinLimit.expect(400);

      expect(validated.body.message).not.toContain('Too many fields');
      expect(JSON.stringify(validated.body)).toContain('extra0');
      await expect(prisma.attachment.count()).resolves.toBe(0);
    });
  });

  describe('MIME', () => {
    it('refuses HTML wearing a .png name with 415, and stores nothing', async () => {
      const where = await seed('html');

      await where.user.agent
        .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
        .field('kind', AttachmentKind.File)
        .attach('file', HTML, { filename: 'harmless.png', contentType: 'image/png' })
        .expect(415);

      await expect(prisma.attachment.count({ where: { taskId: where.taskId } })).resolves.toBe(0);
      await expect(listStorageFiles()).resolves.toEqual([]);
    });

    it('serves a PNG with the sniffed type, inline, and refuses to let a browser re-sniff it', async () => {
      const where = await seed('png');
      const created = await upload(where, PNG, 'shot.png', 'image/png');

      const response = await where.user.agent
        .get(`/workspaces/${where.workspaceId}/attachments/${created.id}/content`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['content-disposition']).toMatch(/^inline;/);
      // **`nosniff` is carried by two mechanisms and this assertion cannot tell them apart —
      // measured, not assumed.** helmet's `noSniff` is on by default in
      // `common/configure-app.ts:24`, so deleting the header from
      // `attachment-download.service.ts` leaves this test green; the descriptor's own copy is
      // pinned by `attachment-download.service.spec.ts` instead. What this line is evidence of
      // is the wire-level guarantee — whichever middleware wrote it, the browser is told not to
      // re-sniff — and that is worth asserting here even though it is not a nail.
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      // CORP is the opposite case: the global policy is `cross-origin`
      // (`configure-app.ts:46`), so `same-origin` here can only have come from this endpoint.
      // Removing it turns this test red.
      expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(response.headers['cache-control']).toBe('private, max-age=0, must-revalidate');
      // The `@Res()` handler writes its own body, so `Content-Length` is the row's `size` rather
      // than anything Express computed. Disagreeing with the stream is a truncated or hung
      // transfer, not an error anybody sees — which is why it is measured against the bytes.
      expect(response.headers['content-length']).toBe(String(PNG.length));
      expect(Buffer.compare(response.body as Buffer, PNG)).toBe(0);
    });

    it('serves a PDF as a download, never inline', async () => {
      const where = await seed('pdf');
      const created = await upload(where, PDF, 'report.pdf', 'application/pdf');

      const response = await where.user.agent
        .get(`/workspaces/${where.workspaceId}/attachments/${created.id}/content`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      expect(created.mimeType).toBe('application/pdf');
      expect(response.headers['content-disposition']).toMatch(/^attachment;/);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('accepts a UTF-8 CSV through the plain-text fallback and serves it as that type', async () => {
      // `file-type` cannot name plain text, so this is the one path where the *declared* type
      // picks the label — after four independent conditions have already decided the bytes are
      // acceptable (`attachment-mime.spec.ts` covers each condition failing on its own).
      const where = await seed('csv');
      const created = await upload(where, CSV, 'export.csv', 'text/csv');

      expect(created.mimeType).toBe('text/csv');

      const response = await where.user.agent
        .get(`/workspaces/${where.workspaceId}/attachments/${created.id}/content`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      // Text is never inline: the label is honest, not permissive.
      expect(response.headers['content-disposition']).toMatch(/^attachment;/);
      expect(Buffer.compare(response.body as Buffer, CSV)).toBe(0);
    });

    it('refuses the same CSV bytes declared as text/html', async () => {
      const where = await seed('csv-html');

      await where.user.agent
        .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
        .field('kind', AttachmentKind.File)
        .attach('file', CSV, { filename: 'export.csv', contentType: 'text/html' })
        .expect(415);

      await expect(prisma.attachment.count()).resolves.toBe(0);
    });
  });

  describe('path traversal', () => {
    it('keeps a traversal filename out of the stored path entirely', async () => {
      const where = await seed('traversal');

      const created = await upload(where, PNG, '../../../../etc/passwd.png', 'image/png');

      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.storageKey).not.toContain('..');
      expect(row.storageKey).toContain(row.id);
      // The user's name survives as a *name* — it just never becomes a path segment (K9).
      expect(row.filename).toBe('passwd.png');

      // And the bytes really are inside the root, not merely named as if they were.
      const files = await listStorageFiles();
      expect(files).toEqual([row.storageKey]);
      await expect(storageFileExists(row.storageKey!)).resolves.toBe(true);
    });

    it('writes a non-ASCII filename twice, and the header stays a single line', async () => {
      // The reachable half of D8. A raw `"`, CR or LF cannot be *sent* through this path at all:
      // superagent percent-encodes them into the multipart parameter and busboy would end the
      // quoted string at the first quote regardless, so the strips in `displayFilename` and
      // `contentDisposition` defend a writer that is not HTTP (an importer) and are pinned by
      // `attachment-disposition.spec.ts`. What *is* reachable is the RFC 5987 pair, and a client
      // that only understands `filename=` must still get a usable name.
      const where = await seed('utf8-name');
      const created = await upload(where, PNG, 'ölçüm raporu.png', 'image/png');

      const response = await where.user.agent
        .get(`/workspaces/${where.workspaceId}/attachments/${created.id}/content`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      const disposition = response.headers['content-disposition'];
      expect(disposition).toBe(
        `inline; filename="_l__m raporu.png"; filename*=UTF-8''${encodeURIComponent('ölçüm raporu.png')}`,
      );
      // The ASCII parameter really is ASCII, so a client that ignores the second one is not
      // handed bytes it cannot spell.
      expect(/filename="([^"]*)"/.exec(disposition)?.[1]).toMatch(/^[\x20-\x7e]*$/);
      // Node would have thrown on a header containing one, but the assertion is the claim.
      expect(disposition).not.toMatch(/[\r\n]/);
    });

    it('stores a non-ASCII filename as the UTF-8 the browser actually sent', async () => {
      // The nail on `defParamCharset: 'utf8'`. multer defaults that option to `'latin1'`
      // (`multer@2.2.0/index.js:22`) while a browser writes the multipart `filename` parameter
      // as UTF-8 (RFC 7578 §5.1), so under the default this same upload was measured landing in
      // the row — and in the panel, and in `Content-Disposition` — as `Ã¶lÃ§Ã¼m raporu.png`.
      // Remove the option from `attachment.module.ts` and this test goes red with exactly that
      // string, which is what makes it a nail rather than a restatement of the code.
      const where = await seed('utf8-row');
      const created = await upload(where, PNG, 'ölçüm raporu.png', 'image/png');

      expect(created.filename).toBe('ölçüm raporu.png');
      // Named explicitly, so the failure message says *which* decoding produced the wrong value
      // rather than only that two strings differ.
      expect(created.filename).not.toBe(Buffer.from('ölçüm raporu.png', 'utf8').toString('latin1'));

      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.filename).toBe('ölçüm raporu.png');
    });

    /**
     * The bidi override, end to end, because the unit specs on both halves can each be true
     * while the assembled path is not.
     *
     * U+202E reverses the rendering of everything after it, so `invoice<RLO>gnp.exe` is drawn
     * as `invoiceexe.png` — in the panel, and in the prompt the browser shows when it asks
     * where to save the file. Unlike the `"`/CR/LF group, this one is fully reachable from a
     * real client: it is legal UTF-8, so superagent sends it and busboy decodes it. Measured
     * reaching the row, the DTO and the RFC 5987 parameter intact before the strip existed.
     */
    it('strips a bidi override from the row and from both header parameters', async () => {
      const where = await seed('bidi');

      const created = await upload(where, PNG, 'invoice\u202egnp.exe.png', 'image/png');

      expect(created.filename).toBe('invoicegnp.exe.png');
      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.filename).toBe('invoicegnp.exe.png');

      const response = await where.user.agent
        .get(`/workspaces/${where.workspaceId}/attachments/${created.id}/content`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      const disposition = response.headers['content-disposition'];
      // The percent-encoded half is the one that carried it: the browser decodes this back
      // into the raw character before it draws the save prompt.
      const encoded = /filename\*=UTF-8''(.*)$/.exec(disposition)?.[1] ?? '';
      expect(decodeURIComponent(encoded)).toBe('invoicegnp.exe.png');
      expect(disposition).not.toContain('%E2%80%AE');
    });

    /**
     * The LINK label, which went through no cleaning at all until this review: `createLink`
     * wrote `dto.filename?.trim()` straight to the row. It never reaches a header — the byte
     * stream answers 404 for a LINK — but it reaches the same panel.
     */
    it('strips a bidi override from a LINK label too', async () => {
      const where = await seed('bidi-link');

      const created = await where.user.agent
        .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
        .send({
          kind: AttachmentKind.Link,
          url: 'https://example.com/a',
          filename: 'invoice\u202egnp.exe',
        })
        .expect(201);

      expect(created.body.filename).toBe('invoicegnp.exe');
    });
    it('keeps only the basename of a Windows-style path', async () => {
      const where = await seed('windows');

      const created = await upload(where, PNG, 'C:\\Users\\me\\..\\secret.png', 'image/png');

      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.filename).toBe('secret.png');
      expect(row.storageKey).not.toContain('..');
      await expect(listStorageFiles()).resolves.toEqual([row.storageKey]);
    });
  });

  describe('the orphan sweep, against a real directory', () => {
    it('leaves the bytes on disk when the task is deleted, and the sweep takes them', async () => {
      const where = await seed('orphan');
      const created = await upload(where, PNG, 'doomed.png', 'image/png');
      const key = await storageKeyOf(created.id);

      await where.user.agent
        .delete(`/workspaces/${where.workspaceId}/tasks/${where.taskId}`)
        .expect(204);

      // The row went with the cascade; the file deliberately did not. Unlinking inline would be
      // a path that never runs for a bulk delete, so the nightly sweep owns it (ADR 0022).
      await expect(prisma.attachment.findUnique({ where: { id: created.id } })).resolves.toBeNull();
      await expect(storageFileExists(key)).resolves.toBe(true);

      // Still inside the grace period: an orphan this young is indistinguishable from an upload
      // whose row has not committed yet (`orphanGraceMs`, job 2).
      const early = await sweep();
      expect(early.orphanedFiles).toBe(0);
      await expect(storageFileExists(key)).resolves.toBe(true);

      await ageStorageFile(key, Date.now() - orphanGraceMs() - 1000);
      const counts = await sweep();

      expect(counts.orphanedFiles).toBe(1);
      await expect(storageFileExists(key)).resolves.toBe(false);
    });

    it('keeps a claimed file even when it looks as old as a restored backup', async () => {
      // `tar -xzf` restores the archived mtimes, so every file a restore puts back looks *old*
      // to this sweep — older than any grace period can cover. What makes the restore safe is
      // not the age check but the claim check: the rows come back from the dump too, and a
      // claimed key is never removed however old it is. The grace period covers the other
      // direction (files uploaded *after* the dump, whose rows the restore rewound away).
      const where = await seed('restored');
      const created = await upload(where, PNG, 'restored.png', 'image/png');
      const key = await storageKeyOf(created.id);

      await ageStorageFile(key, Date.now() - orphanGraceMs() - 90 * 24 * 60 * 60 * 1000);
      const counts = await sweep();

      expect(counts.orphanedFiles).toBe(0);
      await expect(storageFileExists(key)).resolves.toBe(true);
      await where.user.agent
        .get(`/workspaces/${where.workspaceId}/attachments/${created.id}/content`)
        .expect(200);
    });

    it('removes the bytes of a singly detached attachment on the next aged sweep', async () => {
      const where = await seed('detached');
      const created = await upload(where, PNG, 'detached.png', 'image/png');
      const key = await storageKeyOf(created.id);

      await where.user.agent
        .delete(`/workspaces/${where.workspaceId}/attachments/${created.id}`)
        .expect(204);

      await expect(storageFileExists(key)).resolves.toBe(true);
      await ageStorageFile(key, Date.now() - orphanGraceMs() - 1000);

      expect((await sweep()).orphanedFiles).toBe(1);
      await expect(storageFileExists(key)).resolves.toBe(false);
    });
  });

  describe('links (K7)', () => {
    it('stores a link without the server ever requesting it', async () => {
      const where = await seed('link');
      const seen: string[] = [];
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        seen.push(String(input));
        return Promise.reject(new Error('the server must not fetch a link attachment'));
      });

      try {
        // The instrumentation control first: a spy that is not actually installed would make
        // "no fetch happened" true for the wrong reason, and this whole test is a negative.
        await expect(globalThis.fetch('http://127.0.0.1:9/probe')).rejects.toThrow();
        expect(seen).toEqual(['http://127.0.0.1:9/probe']);
        seen.length = 0;

        const created = await where.user.agent
          .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
          .send({ kind: AttachmentKind.Link, url: 'http://127.0.0.1:9/should-never-be-requested' })
          .expect(201);

        expect(seen).toEqual([]);
        expect(created.body.url).toBe('http://127.0.0.1:9/should-never-be-requested');
        expect(created.body.mimeType).toBeNull();
        expect(created.body.size).toBeNull();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it.each(['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd'])(
      'refuses to store %s',
      async (url) => {
        const where = await seed('scheme');

        await where.user.agent
          .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
          .send({ kind: AttachmentKind.Link, url })
          .expect(400);

        await expect(prisma.attachment.count()).resolves.toBe(0);
      },
    );

    it('stores an https URL sent exactly the same way', async () => {
      // The control for the three above: without it, a POST broken for an unrelated reason
      // would answer 400 for every URL and read as a working scheme allowlist.
      const where = await seed('scheme-ok');

      await where.user.agent
        .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
        .send({ kind: AttachmentKind.Link, url: 'https://example.com/spec' })
        .expect(201);

      await expect(prisma.attachment.count()).resolves.toBe(1);
    });

    it('has no bytes to download', async () => {
      const where = await seed('link-content');
      const created = await where.user.agent
        .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
        .send({ kind: AttachmentKind.Link, url: 'https://example.com/spec' })
        .expect(201);

      // 404 rather than 400: saying "wrong kind" would confirm the row exists.
      await where.user.agent
        .get(`/workspaces/${where.workspaceId}/attachments/${created.body.id}/content`)
        .expect(404);
    });
  });

  describe('the byte stream, over a real socket', () => {
    it('ends the connection instead of writing an error body when the stream fails mid-flight', async () => {
      // The unit spec pins the ordering against a fake `Writable`; only a real socket can show
      // what a client receives. `AllExceptionsFilter` ends with an unconditional
      // `response.status(...).json(...)`, so a throw after the headers are out would raise
      // ERR_HTTP_HEADERS_SENT and hand the caller a truncated file that still looked like a 200.
      //
      // **Two mechanisms hold this, and the mutation run says so.** Replacing `res.destroy()`
      // with `res.end()` leaves this green, because Node refuses to finish a response that sent
      // fewer bytes than its own `Content-Length` and destroys the socket itself. Only removing
      // *both* — the destroy and the `Content-Length` header — produces a clean 200 carrying a
      // short file, and then this test goes red. So what is nailed here is the guarantee (a
      // failed transfer is visible as a failed transfer, never as a valid short download), not
      // one particular line that provides it.
      const where = await seed('truncated');
      const created = await upload(where, pngOfSize(4096), 'partial.png', 'image/png');

      jest.spyOn(storage, 'createReadStream').mockImplementation(() =>
        Promise.resolve(
          new Readable({
            read() {
              this.push(Buffer.alloc(512, 0x41));
              this.destroy(new Error('disk went away mid-transfer'));
            },
          }),
        ),
      );

      const failure = await where.user.agent
        .get(`/workspaces/${where.workspaceId}/attachments/${created.id}/content`)
        .buffer(true)
        .parse(binaryParser)
        .then(
          () => null,
          (error: Error) => error,
        );

      // A socket-level failure, not a JSON envelope: the client is told the transfer did not
      // finish rather than being handed a short file it would happily save.
      expect(failure).not.toBeNull();
      expect(String(failure?.message)).toMatch(
        /aborted|ECONNRESET|socket hang up|Parse Error|incomplete/i,
      );
    });

    it('serves the whole file when nothing fails, which is what makes the case above a failure', async () => {
      const where = await seed('whole');
      const bytes = pngOfSize(4096);
      const created = await upload(where, bytes, 'whole.png', 'image/png');

      const response = await where.user.agent
        .get(`/workspaces/${where.workspaceId}/attachments/${created.id}/content`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      expect((response.body as Buffer).length).toBe(bytes.length);
      expect(Buffer.compare(response.body as Buffer, bytes)).toBe(0);
    });
  });

  describe('activity (K6)', () => {
    it('records the upload and the delete, and audits only the delete', async () => {
      const where = await seed('activity');
      const created = await upload(where, PNG, 'audited.png', 'image/png');
      await where.user.agent
        .delete(`/workspaces/${where.workspaceId}/attachments/${created.id}`)
        .expect(204);

      const written = await prisma.activity.findMany({
        where: { workspaceId: where.workspaceId, type: { startsWith: 'attachment.' } },
        orderBy: { id: 'asc' },
      });
      expect(written.map((row) => row.type)).toEqual([
        ActivityType.AttachmentCreated,
        ActivityType.AttachmentDeleted,
      ]);

      // The subset an incident responder reads. `attachment.created` is deliberately outside it
      // — P3-3's importer writes one per imported URL, which is the volume behaviour
      // `comment.created` is excluded for (ADR 0024, `shared-types/src/activity.ts`).
      const audited = await prisma.activity.findMany({
        where: {
          workspaceId: where.workspaceId,
          type: { in: AUDIT_ACTIVITY_TYPES as unknown as string[] },
        },
      });
      const auditedTypes = audited.map((row) => row.type);
      expect(auditedTypes).toContain(ActivityType.AttachmentDeleted);
      expect(auditedTypes).not.toContain(ActivityType.AttachmentCreated);
    });

    it('writes no attachment row for a cascade, which is the boundary the comment claims', async () => {
      const where = await seed('cascade');
      const created = await upload(where, PNG, 'cascaded.png', 'image/png');

      await where.user.agent
        .delete(`/workspaces/${where.workspaceId}/tasks/${where.taskId}`)
        .expect(204);

      await expect(prisma.attachment.findUnique({ where: { id: created.id } })).resolves.toBeNull();
      const written = await prisma.activity.findMany({
        where: { workspaceId: where.workspaceId, type: { startsWith: 'attachment.' } },
      });
      // Only the upload. The cascade runs inside Postgres with no application code to write a
      // row, and `task.deleted` is what answers for it.
      expect(written.map((row) => row.type)).toEqual([ActivityType.AttachmentCreated]);
      await expect(
        prisma.activity.count({
          where: { workspaceId: where.workspaceId, type: ActivityType.TaskDeleted },
        }),
      ).resolves.toBe(1);
    });
  });

  describe('realtime (K5)', () => {
    it('announces task:updated for both mutations, and no attachment event at all', async () => {
      const where = await seed('realtime');
      const emit = jest.spyOn(realtime, 'emitToBoard');

      const created = await upload(where, PNG, 'live.png', 'image/png');
      await where.user.agent
        .delete(`/workspaces/${where.workspaceId}/attachments/${created.id}`)
        .expect(204);

      const events = emit.mock.calls.map((call) => call[1]);
      // Exactly one event name, and it is the one task mutations already emit — no
      // `attachment:added`, no new entry in `SocketEvents` (K5, inherited from ADR 0023).
      expect(new Set(events)).toEqual(new Set([SocketEvents.TASK_UPDATED]));
      expect(events.filter((name) => name.startsWith('attachment'))).toEqual([]);
      expect(events).toHaveLength(2);

      for (const call of emit.mock.calls) {
        expect(call[0]).toBe(where.boardId);
        expect(call[2]).toEqual({
          workspaceId: where.workspaceId,
          boardId: where.boardId,
          taskId: where.taskId,
          actorId: where.userId,
        });
      }

      expect(Object.values(SocketEvents).filter((name) => name.startsWith('attachment'))).toEqual(
        [],
      );
    });
  });
});
