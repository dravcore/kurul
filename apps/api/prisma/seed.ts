import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { assertSeedAllowed } from '../src/common/seed-guard';
import { Priority, PrismaClient } from '../src/generated/prisma';
import { auth } from '../src/auth/auth';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demo-password-change-me';
const DEMO_NAME = 'Demo User';

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

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error(error);
  process.exit(1);
});
