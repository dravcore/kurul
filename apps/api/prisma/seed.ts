import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { assertSeedAllowed } from '../src/common/seed-guard';
import { Priority, PrismaClient } from '../src/generated/prisma';
import { auth } from '../src/auth/auth';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demo-password-change-me';
const DEMO_NAME = 'Demo User';

/**
 * Design-token slots `Label.color` is allowed to hold (CLAUDE.md: never a raw hex). Kept as a
 * literal list rather than generated from a loop so a reader sees the exact vocabulary.
 */
const LABEL_SLOTS = ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5', 'slot-6'] as const;

const LOAD_BOARD_COLUMNS = [
  { name: 'Backlog', position: 1000 },
  { name: 'To Do', position: 2000 },
  { name: 'In Progress', position: 3000 },
  { name: 'Review', position: 4000 },
  { name: 'Done', position: 5000 },
] as const;

const PRIORITY_CYCLE = [Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.URGENT] as const;

/**
 * How many tasks the extra "Load Test Board" gets, from `SEED_LARGE_BOARD_TASKS`.
 *
 * Zero (the default) skips the board entirely, so the everyday `pnpm db:seed` stays the
 * four-task demo it has always been — the large board is opt-in because it exists for one
 * job: reproducing the render profile behind the board's per-column rendering budget
 * (`apps/web/components/board/board-column.tsx`). Anything that is not a positive integer is
 * treated as "not asked for" rather than clamped, so a typo cannot silently seed a board of
 * some other size than the one being measured.
 */
function readLargeBoardTaskCount(raw: string | undefined): number {
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Seeds one board carrying `taskCount` tasks spread over five columns.
 *
 * Written as bulk `createMany` calls rather than a per-task `create` loop: at 1 000 tasks the
 * loop version is ~1 000 round-trips and takes minutes, which is long enough that people stop
 * re-seeding and start measuring against stale data. Positions are spaced 1 000 apart in
 * Float, the same fractional-indexing gap the move endpoint bisects into, so a drag on the
 * seeded board exercises the same `midpoint()` arithmetic a real one does.
 */
async function seedLargeBoard(
  prisma: PrismaClient,
  params: { workspaceId: string; userId: string; taskCount: number },
): Promise<void> {
  const { workspaceId, userId, taskCount } = params;

  const board = await prisma.board.create({
    data: {
      workspaceId,
      name: 'Load Test Board',
      description: `Synthetic board with ${taskCount} tasks for render profiling`,
    },
  });

  const columns = await prisma.column.createManyAndReturn({
    data: LOAD_BOARD_COLUMNS.map((column) => ({
      boardId: board.id,
      name: column.name,
      position: column.position,
    })),
    select: { id: true },
  });

  const labels = await prisma.label.createManyAndReturn({
    data: LABEL_SLOTS.map((slot, index) => ({
      boardId: board.id,
      name: `Label ${index + 1}`,
      color: slot,
    })),
    select: { id: true },
  });

  // Uneven on purpose. An even split hides the case the rendering budget exists for — one
  // column holding most of the board — so the first column takes roughly a third of the tasks
  // and the rest share what is left.
  const columnWeights = [3, 2, 2, 1, 1];
  const weightTotal = columnWeights.reduce((sum, weight) => sum + weight, 0);

  const taskRows: {
    boardId: string;
    columnId: string;
    title: string;
    description: string | null;
    priority: Priority;
    position: number;
    dueDate: Date | null;
    estimatedMinutes: number | null;
    createdById: string;
  }[] = [];

  let created = 0;
  for (const [columnIndex, column] of columns.entries()) {
    const isLast = columnIndex === columns.length - 1;
    const share = isLast
      ? taskCount - created
      : Math.round((taskCount * columnWeights[columnIndex]!) / weightTotal);

    for (let index = 0; index < share; index += 1) {
      const serial = created + index + 1;
      taskRows.push({
        boardId: board.id,
        columnId: column.id,
        title: `Load task ${serial} — ${LOAD_BOARD_COLUMNS[columnIndex]!.name.toLowerCase()} item`,
        // Only every third row carries a description: a board where every card is identical
        // measures one shape of card, and the panel's empty-description path is worth having
        // real rows for too.
        description: serial % 3 === 0 ? `Synthetic description for load task ${serial}` : null,
        priority: PRIORITY_CYCLE[serial % PRIORITY_CYCLE.length]!,
        position: (index + 1) * 1000,
        // Spread across the due-soon window and past it, so the due-date treatments on the
        // card (overdue, soon, none) all appear on the seeded board.
        dueDate: serial % 4 === 0 ? new Date(Date.now() + (serial % 30) * 86_400_000) : null,
        estimatedMinutes: serial % 5 === 0 ? 30 * (1 + (serial % 8)) : null,
        createdById: userId,
      });
    }
    created += share;
  }

  // Chunked because a single INSERT carrying 1 000 rows × 9 columns is ~9 000 bind parameters,
  // past Postgres's 65 535 limit once the board grows past a few thousand tasks. 500 keeps the
  // statement well inside it at any size this seed is asked for.
  const CHUNK = 500;
  const taskIds: string[] = [];
  for (let offset = 0; offset < taskRows.length; offset += CHUNK) {
    const inserted = await prisma.task.createManyAndReturn({
      data: taskRows.slice(offset, offset + CHUNK),
      select: { id: true },
    });
    taskIds.push(...inserted.map((task) => task.id));
  }

  // Roughly half the tasks carry one or two labels. Label chips are the most expensive part of
  // a card to render, so a board with none of them would flatter the profile.
  const taskLabelRows: { taskId: string; labelId: string }[] = [];
  for (const [index, taskId] of taskIds.entries()) {
    if (index % 2 !== 0) continue;
    taskLabelRows.push({ taskId, labelId: labels[index % labels.length]!.id });
    if (index % 6 === 0) {
      taskLabelRows.push({ taskId, labelId: labels[(index + 3) % labels.length]!.id });
    }
  }
  for (let offset = 0; offset < taskLabelRows.length; offset += CHUNK) {
    await prisma.taskLabel.createMany({ data: taskLabelRows.slice(offset, offset + CHUNK) });
  }

  // Every fourth task is assigned to the demo user, so avatars render on part of the board.
  const assigneeRows = taskIds
    .filter((_, index) => index % 4 === 0)
    .map((taskId) => ({ taskId, userId }));
  for (let offset = 0; offset < assigneeRows.length; offset += CHUNK) {
    await prisma.taskAssignee.createMany({ data: assigneeRows.slice(offset, offset + CHUNK) });
  }

  console.log(`Seeded load-test board id=${board.id} with ${taskIds.length} tasks`);
}

async function main(): Promise<void> {
  // The seed wipes every table below — refuse before touching anything in production.
  assertSeedAllowed(process.env.NODE_ENV);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  await prisma.activity.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.taskLabel.deleteMany();
  await prisma.taskAssignee.deleteMany();
  await prisma.task.deleteMany();
  await prisma.label.deleteMany();
  await prisma.column.deleteMany();
  await prisma.board.deleteMany();
  await prisma.workspaceInvitation.deleteMany();
  await prisma.workspaceMember.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.user.deleteMany();

  const signUp = await auth.api.signUpEmail({
    body: {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      name: DEMO_NAME,
    },
  });

  const userId = signUp.user.id;

  const workspace = await auth.api.createOrganization({
    body: {
      name: 'Demo Workspace',
      slug: 'demo',
      userId,
      keepCurrentActiveOrganization: false,
    },
  });

  if (!workspace) {
    throw new Error('Failed to create demo workspace');
  }

  const board = await prisma.board.create({
    data: {
      workspaceId: workspace.id,
      name: 'Product Board',
      description: 'Demo board for local development',
    },
  });

  const [todo, inProgress, done] = await Promise.all([
    prisma.column.create({
      data: { boardId: board.id, name: 'To Do', position: 1000 },
    }),
    prisma.column.create({
      data: { boardId: board.id, name: 'In Progress', position: 2000 },
    }),
    prisma.column.create({
      data: { boardId: board.id, name: 'Done', position: 3000 },
    }),
  ]);

  await prisma.task.createMany({
    data: [
      {
        boardId: board.id,
        columnId: todo.id,
        title: 'Set up monorepo skeleton',
        description: 'pnpm workspace, NestJS, Next.js, Prisma',
        priority: Priority.HIGH,
        position: 1000,
        createdById: userId,
        estimatedMinutes: 240,
      },
      {
        boardId: board.id,
        columnId: todo.id,
        title: 'Wire Better Auth',
        priority: Priority.MEDIUM,
        position: 2000,
        createdById: userId,
        estimatedMinutes: 180,
      },
      {
        boardId: board.id,
        columnId: inProgress.id,
        title: 'Draft design tokens',
        priority: Priority.LOW,
        position: 1000,
        createdById: userId,
      },
      {
        boardId: board.id,
        columnId: done.id,
        title: 'Write Phase 0 docs',
        priority: Priority.URGENT,
        position: 1000,
        createdById: userId,
        estimatedMinutes: 480,
      },
    ],
  });

  console.log(`Seeded demo user ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);

  console.log(`Seeded workspace slug=demo id=${workspace.id}`);

  const largeBoardTaskCount = readLargeBoardTaskCount(process.env.SEED_LARGE_BOARD_TASKS);
  if (largeBoardTaskCount > 0) {
    await seedLargeBoard(prisma, {
      workspaceId: workspace.id,
      userId,
      taskCount: largeBoardTaskCount,
    });
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error(error);
  process.exit(1);
});
