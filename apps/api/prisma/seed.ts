import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { MemberRole, Priority, PrismaClient } from '../src/generated/prisma';

async function main(): Promise<void> {
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
  await prisma.workspaceMember.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();

  const user = await prisma.user.create({
    data: {
      email: 'demo@kurultay.dev',
      name: 'Demo User',
    },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: 'Demo Workspace',
      slug: 'demo',
      members: {
        create: {
          userId: user.id,
          role: MemberRole.OWNER,
        },
      },
    },
  });

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
        createdById: user.id,
        estimatedMinutes: 240,
      },
      {
        boardId: board.id,
        columnId: todo.id,
        title: 'Wire Better Auth',
        priority: Priority.MEDIUM,
        position: 2000,
        createdById: user.id,
        estimatedMinutes: 180,
      },
      {
        boardId: board.id,
        columnId: inProgress.id,
        title: 'Draft design tokens',
        priority: Priority.LOW,
        position: 1000,
        createdById: user.id,
      },
      {
        boardId: board.id,
        columnId: done.id,
        title: 'Write Phase 0 docs',
        priority: Priority.URGENT,
        position: 1000,
        createdById: user.id,
        estimatedMinutes: 480,
      },
    ],
  });

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error(error);
  process.exit(1);
});
