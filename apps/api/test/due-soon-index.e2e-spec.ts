import { INestApplication } from '@nestjs/common';
import { NotificationType } from '@kurultay/shared-types';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { createWorkspace, signUp } from './helpers/auth';
import { resetDatabase } from './helpers/db';

const INDEX_NAME = 'Notification_due_soon_unread_uidx';

/**
 * `Notification_due_soon_unread_uidx` is a *partial* unique index, and Prisma's schema
 * language has no way to say `WHERE`. It exists only in
 * `migrations/20260809180000_due_soon_perf_indexes/migration.sql` and as a comment on the
 * `Notification` model — which means `prisma migrate dev` sees an index the schema does not
 * declare, calls it drift, and can offer to drop it.
 *
 * Nothing else notices if it goes: `createMany({ skipDuplicates: true })` in
 * `due-soon.worker.ts` is `ON CONFLICT DO NOTHING`, and with no unique index to conflict on
 * that clause is simply a no-op. Every scheduler tick would then write one more copy of the
 * same unread reminder, and the first sign of it would be users with a notification list
 * full of the same task. These tests are the tripwire for that.
 */
describe('Due-soon partial unique index (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function seedTask(): Promise<{ workspaceId: string; userId: string; taskId: string }> {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'DueSoon', `ds-${Date.now()}`);
    const me = await owner.agent.get('/me').expect(200);
    const board = await owner.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Board' })
      .expect(201);
    const columns = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
      .expect(200);
    const task = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${board.body.id}/tasks`)
      .send({ title: 'Ship it', columnId: columns.body[0].id })
      .expect(201);

    return {
      workspaceId: workspace.id,
      userId: me.body.id as string,
      taskId: task.body.id as string,
    };
  }

  function dueSoonRow(seed: { workspaceId: string; userId: string; taskId: string }): {
    workspaceId: string;
    userId: string;
    taskId: string;
    type: string;
    payload: { title: string };
  } {
    return {
      workspaceId: seed.workspaceId,
      userId: seed.userId,
      taskId: seed.taskId,
      type: NotificationType.DueSoon,
      payload: { title: 'Ship it' },
    };
  }

  it('is present on the Notification table as a unique index', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'Notification'
        AND indexname = ${INDEX_NAME}
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain('CREATE UNIQUE INDEX');
  });

  it('stays scoped to unread due_soon rows with a task', async () => {
    // The predicate is the whole design: a wider index would forbid a second mention on the
    // same task, or forbid re-notifying a task whose earlier reminder was already read.
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'Notification'
        AND indexname = ${INDEX_NAME}
    `;
    const definition = rows[0]?.indexdef ?? '';

    expect(definition).toMatch(/WHERE /);
    expect(definition).toContain(`'due_soon'`);
    expect(definition).toMatch(/"readAt" IS NULL/);
    expect(definition).toMatch(/"taskId" IS NOT NULL/);
    expect(definition).toMatch(/\("userId", "taskId"\)/);
  });

  it('survives in the pg_index catalog as a unique, valid, partial index on (userId, taskId)', async () => {
    // Belt to the indexdef tests' braces: pg_indexes goes through pg_get_indexdef, whose
    // formatting is Postgres's to change. The catalog flags and the parsed predicate are
    // not — so a migration that recreates the index non-unique, non-partial, or over
    // different columns fails here no matter how the definition happens to print.
    const rows = await prisma.$queryRaw<
      Array<{
        indisunique: boolean;
        indisvalid: boolean;
        columns: string[];
        predicate: string | null;
      }>
    >`
      SELECT i.indisunique,
             i.indisvalid,
             ARRAY(
               -- \`name\` is not a type Prisma's raw deserializer knows; hand it text.
               SELECT a.attname::text
               FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
               ORDER BY k.ord
             )::text[] AS columns,
             pg_get_expr(i.indpred, i.indrelid) AS predicate
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()
        AND c.relname = ${INDEX_NAME}
    `;

    expect(rows).toHaveLength(1);
    const index = rows[0]!;
    expect(index.indisunique).toBe(true);
    expect(index.indisvalid).toBe(true);
    expect(index.columns).toEqual(['userId', 'taskId']);
    // No predicate would mean someone rebuilt it as a full unique index — which does not
    // deduplicate unread reminders, it forbids legitimate rows (read + unread pairs,
    // repeated mentions) outright.
    expect(index.predicate).not.toBeNull();
    expect(index.predicate).toContain(`'due_soon'`);
    expect(index.predicate).toMatch(/"readAt" IS NULL/);
    expect(index.predicate).toMatch(/"taskId" IS NOT NULL/);
  });

  it('makes a repeated unread reminder a no-op instead of a duplicate', async () => {
    const seed = await seedTask();

    await prisma.notification.createMany({ data: [dueSoonRow(seed)], skipDuplicates: true });
    // A second scheduler tick over the same still-unread task.
    await prisma.notification.createMany({ data: [dueSoonRow(seed)], skipDuplicates: true });

    const count = await prisma.notification.count({
      where: { userId: seed.userId, taskId: seed.taskId, type: NotificationType.DueSoon },
    });
    expect(count).toBe(1);
  });

  it('lets a task be re-notified once the earlier reminder has been read', async () => {
    const seed = await seedTask();
    await prisma.notification.createMany({ data: [dueSoonRow(seed)], skipDuplicates: true });

    await prisma.notification.updateMany({
      where: { userId: seed.userId, taskId: seed.taskId },
      data: { readAt: new Date() },
    });
    await prisma.notification.createMany({ data: [dueSoonRow(seed)], skipDuplicates: true });

    // The read row leaves the index's predicate, so the new unread one does not collide.
    const unread = await prisma.notification.count({
      where: { userId: seed.userId, taskId: seed.taskId, readAt: null },
    });
    expect(unread).toBe(1);
    expect(
      await prisma.notification.count({ where: { userId: seed.userId, taskId: seed.taskId } }),
    ).toBe(2);
  });

  it('leaves repeats of other notification types alone', async () => {
    const seed = await seedTask();
    const mention = { ...dueSoonRow(seed), type: NotificationType.Mention };

    await prisma.notification.createMany({ data: [mention], skipDuplicates: true });
    await prisma.notification.createMany({ data: [mention], skipDuplicates: true });

    // Two people can mention the same person on the same task; that is not a duplicate.
    expect(
      await prisma.notification.count({
        where: { userId: seed.userId, taskId: seed.taskId, type: NotificationType.Mention },
      }),
    ).toBe(2);
  });
});
