import { loadRootEnv } from '../common/env';
import { MemberRole, PrismaClient } from '../generated/prisma';
import { closeSharedDatabase, createSharedPrismaAdapter } from '../prisma/database';
import {
  DEMO_BOARDS,
  DEMO_TEAMMATE_EMAIL,
  DEMO_TEAMMATE_NAME,
  DEMO_USER_EMAIL,
  DEMO_USER_NAME,
  DEMO_WORKSPACE_NAME,
  DEMO_WORKSPACE_SLUG,
  type DemoBoardSeed,
  type DemoPerson,
} from './demo-dataset';
import { assertDemoResetAllowed } from './reset-guard';

/**
 * Wipes the demo instance and restores the golden dataset. Entry point: `node dist/demo/reset.js`.
 *
 * ## Why this ships in the image
 *
 * The `demo` compose profile runs this file from the **same `ghcr.io/dravcore/kurul-api` image
 * the API runs from**, on a loop, in a sidecar. That constraint is the reason it exists at all
 * rather than the reset being `pnpm db:seed` on a timer:
 *
 * - `prisma.config.ts` runs the seed as `pnpm exec tsx apps/api/prisma/seed.ts`. The runner
 *   image has no `tsx`, no pnpm workspace and no `apps/` tree — it has `dist`, `node_modules`
 *   and `package.json` (`apps/api/Dockerfile`). There is nothing there for that command to run.
 * - `assertSeedAllowed` refuses under `NODE_ENV=production`, which the runner image bakes in.
 *   The correct answer to that is *not* a sidecar that unsets `NODE_ENV` — that would make the
 *   safety mechanism "an environment variable somebody remembered not to set". See
 *   `reset-guard.ts` for the two checks that replace it.
 *
 * So this is ordinary API source: it compiles into `dist` with everything else, imports the
 * Prisma client and the Better Auth instance that are already in the image, and adds nothing to
 * the runtime dependency set.
 *
 * ## Sessions
 *
 * Every `Session` row goes, including the one this script creates for itself when it signs the
 * demo account up. There is no way around the first part (the wipe deletes `User`, and sessions
 * cascade from it) and no reason to want one: a session pointing at a user id that no longer
 * exists is worse than no session.
 *
 * What that does **not** buy is instant sign-out in the browser, and it is worth being precise
 * about rather than claiming otherwise. `better-auth.session_data` is a signed cookie that
 * `auth.api.getSession` answers from without touching the database for up to 60 seconds
 * (`SESSION_COOKIE_CACHE_MAX_AGE_SECONDS` in `auth.ts`, and `session-cookie-names.ts` on why
 * there are two cookies). So for up to a minute after a reset, a visitor who was mid-session
 * keeps being recognised as a user who no longer exists: reads return an empty account, and a
 * write that references their id fails. Once the cache expires the request is a plain `401`,
 * and the web app already handles that end state - `apps/web/middleware.ts` checks the session
 * on every navigation and redirects to `/login?next=…`, and `WorkspaceProvider`'s
 * `authClient.useSession()` does the same for a client-side transition.
 *
 * That one-minute seam is inherent to a signed cookie cache and is the same window ADR 0026
 * documents for a force-deleted account. On a demo it costs a visitor the last thing they typed
 * in the minute their hour ran out, which the banner has already told them was coming.
 *
 * ## What it does not touch
 *
 * Attachment *rows* are deleted with everything else; the *files* under `STORAGE_PATH` are not.
 * Deleting bytes is never a side effect of a delete path in this codebase — the nightly orphan
 * sweep (`retention/cleanup.worker.ts`, ADR 0022) owns that, and it is the same sweep that
 * already handles a cascaded workspace deletion. A demo host that leaves the sweep running
 * reclaims the space on its own schedule.
 */

/** Better Auth's own floor. Checked here so the failure names the variable, not a library rule. */
const MIN_DEMO_PASSWORD_LENGTH = 8;

/** Fractional-index gap between seeded rows, matching `prisma/seed.ts`. */
const POSITION_STEP = 1000;

const DAY_MS = 86_400_000;

export interface DemoResetSummary {
  workspaceId: string;
  boards: number;
  tasks: number;
  comments: number;
}

/**
 * Deletes every tenant and auth row, in foreign-key order.
 *
 * The same list and the same order as `test/helpers/db.ts`, which is the one place in the
 * repository that has to stay complete: a table missing from it leaves rows behind that the
 * next insert collides with. Kept as explicit `deleteMany` calls rather than a
 * `TRUNCATE ... CASCADE`, because `CASCADE` would follow foreign keys out of this list into
 * whatever a future migration adds, and "delete everything the schema can reach" is not a
 * thing to write once and never re-read.
 */
async function wipe(prisma: PrismaClient): Promise<void> {
  await prisma.usagePing.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.checklistItem.deleteMany();
  await prisma.checklist.deleteMany();
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
}

/**
 * Reads `index` out of `rows`, naming the dataset field that pointed at nothing.
 *
 * `noUncheckedIndexedAccess` forces the question and the answer is worth having: the dataset
 * addresses columns and labels by position, so a reordered `columns` array with a stale
 * `column: 4` is the realistic mistake. Failing here means the sidecar logs one readable line
 * and the previous dataset is already gone; the alternative — a silent `undefined` reaching
 * Prisma — is a board missing a column with a foreign-key error five frames away.
 */
function at<T>(rows: readonly T[], index: number, what: string): T {
  const row = rows[index];
  if (row === undefined) {
    throw new Error(`Demo dataset points at ${what} ${index}, which does not exist`);
  }
  return row;
}

/** Writes one board and everything hanging off it, returning what it created. */
async function seedBoard(
  prisma: PrismaClient,
  params: {
    workspaceId: string;
    people: Record<DemoPerson, string>;
    board: DemoBoardSeed;
    now: Date;
  },
): Promise<{ tasks: number; comments: number }> {
  const { workspaceId, people, board, now } = params;

  const created = await prisma.board.create({
    data: { workspaceId, name: board.name, description: board.description },
  });

  const columns = await prisma.column.createManyAndReturn({
    data: board.columns.map((column, index) => ({
      boardId: created.id,
      name: column.name,
      category: column.category,
      position: (index + 1) * POSITION_STEP,
    })),
    select: { id: true },
  });

  const labels = await prisma.label.createManyAndReturn({
    data: board.labels.map((label) => ({
      boardId: created.id,
      name: label.name,
      color: label.color,
    })),
    select: { id: true },
  });

  // One counter per column so positions are spaced within a column, which is what fractional
  // indexing bisects — a board-wide counter would work but would not look like a real board.
  const nextPosition = board.columns.map(() => POSITION_STEP);
  let comments = 0;

  for (const seed of board.tasks) {
    const columnId = at(columns, seed.column, 'column').id;
    const position = at(nextPosition, seed.column, 'column');
    nextPosition[seed.column] = position + POSITION_STEP;

    const task = await prisma.task.create({
      data: {
        boardId: created.id,
        columnId,
        title: seed.title,
        description: seed.description ?? null,
        priority: seed.priority,
        position,
        dueDate:
          seed.dueInDays === undefined ? null : new Date(now.getTime() + seed.dueInDays * DAY_MS),
        estimatedMinutes: seed.estimatedMinutes ?? null,
        createdById: people.demo,
      },
      select: { id: true },
    });

    if (seed.labels?.length) {
      await prisma.taskLabel.createMany({
        data: seed.labels.map((index) => ({
          taskId: task.id,
          labelId: at(labels, index, 'label').id,
        })),
      });
    }

    if (seed.assignees?.length) {
      await prisma.taskAssignee.createMany({
        data: seed.assignees.map((person) => ({ taskId: task.id, userId: people[person] })),
      });
    }

    for (const comment of seed.comments ?? []) {
      await prisma.comment.create({
        data: {
          taskId: task.id,
          userId: people[comment.author],
          body: comment.body,
          createdAt: new Date(now.getTime() - comment.daysAgo * DAY_MS),
        },
      });
      comments += 1;
    }

    for (const [index, checklist] of (seed.checklists ?? []).entries()) {
      await prisma.checklist.create({
        data: {
          taskId: task.id,
          title: checklist.title,
          position: (index + 1) * POSITION_STEP,
          items: {
            create: checklist.items.map((item, itemIndex) => ({
              content: item.content,
              isDone: item.isDone,
              position: (itemIndex + 1) * POSITION_STEP,
            })),
          },
        },
      });
    }
  }

  return { tasks: board.tasks.length, comments };
}

/**
 * Empties the database and writes the golden dataset. Exported so the integration suite can
 * run the real thing rather than a re-implementation of it.
 *
 * The caller owns the guard and the Prisma client. `main` below does both for the container;
 * the e2e spec does both for a test database, and asserts the guard separately.
 */
export async function resetDemoData(
  prisma: PrismaClient,
  password: string,
  now: Date = new Date(),
): Promise<DemoResetSummary> {
  if (password.length < MIN_DEMO_PASSWORD_LENGTH) {
    throw new Error(
      `DEMO_PASSWORD must be at least ${MIN_DEMO_PASSWORD_LENGTH} characters — it is the ` +
        'published login for a public instance, so it is set by the operator and never defaulted.',
    );
  }

  // Imported here rather than at the top of the file so that nothing about Better Auth's
  // construction runs before `main` has cleared the guard. `auth.ts` throws at module load when
  // `BETTER_AUTH_SECRET` is missing, and a static import made *that* the first thing an
  // operator saw when they ran this with the guard unsatisfied — a stack trace about a secret,
  // where the actual answer is "this refuses to touch that database". `seed.ts` states the same
  // principle in one line: refuse before touching anything.
  // `.js` because the dynamic specifier is resolved under NodeNext, unlike the static imports
  // above; both Jest configs already strip the suffix so the same line resolves to `auth.ts`.
  const { auth } = await import('../auth/auth.js');

  await wipe(prisma);

  // Through Better Auth rather than a raw `user` + `account` insert: the password hash format
  // is Better Auth's business, and a fixture that writes one by hand is a copy of an internal
  // detail that silently stops matching on a library upgrade.
  const signUp = await auth.api.signUpEmail({
    body: { email: DEMO_USER_EMAIL, password, name: DEMO_USER_NAME },
  });
  const demoUserId = signUp.user.id;

  // Marked verified without a mailbox ever confirming it, which is the one honest option here:
  // demo mode routes mail to the log transport, so no verification link is ever delivered and
  // the flow could not complete. The account is a published fixture, not a claim that somebody
  // owns `demo@kurul.dev`.
  await prisma.user.update({ where: { id: demoUserId }, data: { emailVerified: true } });

  const teammate = await prisma.user.create({
    data: { email: DEMO_TEAMMATE_EMAIL, name: DEMO_TEAMMATE_NAME, emailVerified: true },
    select: { id: true },
  });

  const workspace = await auth.api.createOrganization({
    body: {
      name: DEMO_WORKSPACE_NAME,
      slug: DEMO_WORKSPACE_SLUG,
      userId: demoUserId,
      keepCurrentActiveOrganization: false,
    },
  });

  if (!workspace) {
    throw new Error('Failed to create the demo workspace');
  }

  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: teammate.id, role: MemberRole.MEMBER },
  });

  const people: Record<DemoPerson, string> = { demo: demoUserId, teammate: teammate.id };

  let tasks = 0;
  let comments = 0;
  for (const board of DEMO_BOARDS) {
    const written = await seedBoard(prisma, { workspaceId: workspace.id, people, board, now });
    tasks += written.tasks;
    comments += written.comments;
  }

  // `signUpEmail` signs the new account in, so the reset leaves behind a session of its own.
  // Nobody holds its cookie and nothing will ever present it, which makes it a credential with
  // no owner sitting in the database until it expires. The invariant is worth being able to
  // state plainly: **a reset ends every session, including the one it just created.**
  await prisma.session.deleteMany();

  return { workspaceId: workspace.id, boards: DEMO_BOARDS.length, tasks, comments };
}

async function main(): Promise<void> {
  // Present for a local run against a `kurul_demo` database; a no-op inside the image, which
  // has no workspace root to find and takes its environment from the container runtime.
  loadRootEnv();

  const databaseName = assertDemoResetAllowed({
    demoMode: process.env.DEMO_MODE,
    databaseUrl: process.env.DATABASE_URL,
  });

  const password = process.env.DEMO_PASSWORD?.trim();
  if (!password) {
    throw new Error(
      'DEMO_PASSWORD is required: it is the published password for the demo account, and a ' +
        'default baked into an open-source image would be the same password on every demo host.',
    );
  }

  const prisma = new PrismaClient({ adapter: createSharedPrismaAdapter() });
  try {
    const summary = await resetDemoData(prisma, password);
    console.log(
      `Demo reset complete on "${databaseName}": workspace=${summary.workspaceId} ` +
        `boards=${summary.boards} tasks=${summary.tasks} comments=${summary.comments}`,
    );
  } finally {
    await prisma.$disconnect();
    // Better Auth borrows this process's shared pool (`auth.ts`), so the pool's owner drains
    // both clients. Without it the process keeps a live pool and never exits, which in a sleep
    // loop is a container that stops resetting and stays "Up".
    await closeSharedDatabase();
  }
}

// Guarded so importing this module from a test does not empty a database on import.
if (require.main === module) {
  main()
    // Explicit rather than falling off the end of the event loop. This is a one-shot command
    // whose caller is a `sleep` loop, and importing `auth.ts` constructs whatever Better Auth
    // builds at module load — today an ioredis client with `lazyConnect`, tomorrow whatever a
    // version bump adds. One stray keep-alive handle would turn a completed reset into a
    // container that is "Up" and never resets again; the healthcheck would eventually catch
    // that, but not before the demo had gone stale for two intervals.
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
