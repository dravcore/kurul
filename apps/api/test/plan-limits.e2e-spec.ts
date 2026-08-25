import { INestApplication } from '@nestjs/common';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { ActivityType, MemberRole, PLAN_LIMIT_ERROR, PlanLimitCode } from '@kurul/shared-types';
import { PrismaService } from '../src/prisma/prisma.service';
import { PLAN_LIMIT_ENV } from '../src/plan/plan-limits';
import { createTestApp } from './helpers/app';
import {
  buildUniqueSlug,
  confirmEmail,
  createWorkspace,
  signUp,
  uniqueEmail,
} from './helpers/auth';
import { resetDatabase } from './helpers/db';

/**
 * The plan-limit layer of ADR 0032, measured through the assembled stack.
 *
 * The unit specs pin the resolver (override > environment > unlimited) and what each `assert`
 * asks Prisma. What only this file can answer is what a client actually receives: that the
 * refusal is a `403` whose `error` and `planLimit` a client can branch on, that the write it
 * refused did not happen, and that an instance which configures nothing behaves exactly as it
 * did before this layer existed.
 *
 * ## How the ceilings change mid-suite
 *
 * `readInstancePlanLimits()` reads `process.env` on every call and memoizes nothing, so a test
 * sets a variable and the very next request sees it. No app rebuild, and no singleton to drop.
 */
describe('Plan limits (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const previous = new Map<string, string | undefined>();

  beforeAll(async () => {
    for (const name of Object.values(PLAN_LIMIT_ENV)) {
      previous.set(name, process.env[name]);
      delete process.env[name];
    }
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    for (const name of Object.values(PLAN_LIMIT_ENV)) {
      delete process.env[name];
    }
  });

  function setLimit(name: string, value: number | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = String(value);
  }

  describe('unlimited when unset', () => {
    it('lets an unconfigured instance create workspaces, boards, invitations and accounts', async () => {
      const owner = await signUp(app, { name: 'Nobody Configured Anything' });
      const first = await createWorkspace(owner.agent, 'One', 'unlimited-a');
      await createWorkspace(owner.agent, 'Two', 'unlimited-b');

      for (const name of ['Board A', 'Board B', 'Board C']) {
        await owner.agent.post(`/workspaces/${first.id}/boards`).send({ name }).expect(201);
      }
      await owner.agent
        .post(`/workspaces/${first.id}/invitations`)
        .send({ email: uniqueEmail('invitee'), role: MemberRole.MEMBER })
        .expect(201);
      await signUp(app, { name: 'Second Account' });

      const plan = await owner.agent.get(`/workspaces/${first.id}/plan`).expect(200);
      // Seats and boards are unlimited because nobody configured them. `storageBytes` is not:
      // the byte quota it wraps has had a default since ADR 0027's 2026-08-21 update, and this
      // layer publishes that number rather than inventing a second answer for it.
      expect(plan.body.limits).toMatchObject({ seats: null, boards: null });
      expect(plan.body.limits.storageBytes).toBe(2_147_483_648);
      expect(plan.body.usage).toMatchObject({ seats: 2, boards: 3 });
    });
  });

  describe('boards', () => {
    it('refuses the board over the ceiling and writes nothing', async () => {
      const owner = await signUp(app, { name: 'Board Owner' });
      const workspace = await createWorkspace(owner.agent, 'Boards', 'boards-limit');
      setLimit(PLAN_LIMIT_ENV.boardsPerWorkspace, 1);

      await owner.agent
        .post(`/workspaces/${workspace.id}/boards`)
        .send({ name: 'First' })
        .expect(201);

      const refused = await owner.agent
        .post(`/workspaces/${workspace.id}/boards`)
        .send({ name: 'Second' })
        .expect(403);

      expect(refused.body).toMatchObject({
        statusCode: 403,
        error: PLAN_LIMIT_ERROR,
        planLimit: { code: PlanLimitCode.Boards, limit: 1, current: 1 },
      });
      expect(refused.body.requestId).toEqual(expect.any(String));
      await expect(prisma.board.count({ where: { workspaceId: workspace.id } })).resolves.toBe(1);
      // The board's columns are part of the same transaction, so a refused create leaves none.
      await expect(prisma.column.count()).resolves.toBe(defaultColumnCountOf(1));
    });

    /**
     * The importer is the other route that adds a board, and it creates one by a different
     * call (`tx.board.create` in `TrelloImportService`, not `BoardService.create`), so a ceiling
     * enforced on `POST .../boards` alone would be a ceiling any admin with a small export
     * could step over. The same `403`, the same `planLimit`, and a database the refused import
     * never touched: no board, no columns beyond the first board's own, no tasks and no
     * `board.imported` activity row.
     */
    it('refuses a Trello import at the ceiling with the same 403, and writes nothing', async () => {
      const owner = await signUp(app, { name: 'Import Owner' });
      const workspace = await createWorkspace(owner.agent, 'Imports', 'boards-import');
      setLimit(PLAN_LIMIT_ENV.boardsPerWorkspace, 1);

      await owner.agent
        .post(`/workspaces/${workspace.id}/boards`)
        .send({ name: 'First' })
        .expect(201);

      const refused = await owner.agent
        .post(`/workspaces/${workspace.id}/imports/trello`)
        .attach('file', TRELLO_FIXTURE, 'trello.json')
        .expect(403);

      expect(refused.body).toMatchObject({
        statusCode: 403,
        error: PLAN_LIMIT_ERROR,
        planLimit: { code: PlanLimitCode.Boards, limit: 1, current: 1 },
      });
      await expect(prisma.board.count({ where: { workspaceId: workspace.id } })).resolves.toBe(1);
      await expect(prisma.column.count()).resolves.toBe(defaultColumnCountOf(1));
      await expect(prisma.task.count()).resolves.toBe(0);
      await expect(prisma.attachment.count()).resolves.toBe(0);
      await expect(
        prisma.activity.count({ where: { type: ActivityType.BoardImported } }),
      ).resolves.toBe(0);

      // The control: one more board of room, and the same export goes through the same route.
      setLimit(PLAN_LIMIT_ENV.boardsPerWorkspace, 2);
      await owner.agent
        .post(`/workspaces/${workspace.id}/imports/trello`)
        .attach('file', TRELLO_FIXTURE, 'trello.json')
        .expect(201);
      await expect(prisma.board.count({ where: { workspaceId: workspace.id } })).resolves.toBe(2);
    });

    it('counts each workspace on its own', async () => {
      const owner = await signUp(app, { name: 'Two Workspaces' });
      const first = await createWorkspace(owner.agent, 'First', 'boards-scope-a');
      const second = await createWorkspace(owner.agent, 'Second', 'boards-scope-b');
      setLimit(PLAN_LIMIT_ENV.boardsPerWorkspace, 1);

      await owner.agent.post(`/workspaces/${first.id}/boards`).send({ name: 'A' }).expect(201);
      await owner.agent.post(`/workspaces/${first.id}/boards`).send({ name: 'B' }).expect(403);
      await owner.agent.post(`/workspaces/${second.id}/boards`).send({ name: 'C' }).expect(201);
    });

    it('lets a workspace override the instance ceiling, in both directions', async () => {
      const owner = await signUp(app, { name: 'Override Owner' });
      const capped = await createWorkspace(owner.agent, 'Capped', 'boards-capped');
      const lifted = await createWorkspace(owner.agent, 'Lifted', 'boards-lifted');
      setLimit(PLAN_LIMIT_ENV.boardsPerWorkspace, 1);

      await prisma.workspace.update({
        where: { id: lifted.id },
        data: { planLimits: { boards: null } },
      });
      await prisma.workspace.update({
        where: { id: capped.id },
        data: { planLimits: { boards: 2 } },
      });

      await owner.agent.post(`/workspaces/${lifted.id}/boards`).send({ name: 'A' }).expect(201);
      await owner.agent.post(`/workspaces/${lifted.id}/boards`).send({ name: 'B' }).expect(201);

      await owner.agent.post(`/workspaces/${capped.id}/boards`).send({ name: 'A' }).expect(201);
      await owner.agent.post(`/workspaces/${capped.id}/boards`).send({ name: 'B' }).expect(201);
      await owner.agent.post(`/workspaces/${capped.id}/boards`).send({ name: 'C' }).expect(403);
    });

    it('ignores an unreadable override rather than refusing every write in the workspace', async () => {
      const owner = await signUp(app, { name: 'Bad Override' });
      const workspace = await createWorkspace(owner.agent, 'Bad', 'boards-bad-override');
      await prisma.workspace.update({
        where: { id: workspace.id },
        data: { planLimits: { boards: 'plenty' } },
      });
      setLimit(PLAN_LIMIT_ENV.boardsPerWorkspace, 1);

      await owner.agent.post(`/workspaces/${workspace.id}/boards`).send({ name: 'A' }).expect(201);
      await owner.agent.post(`/workspaces/${workspace.id}/boards`).send({ name: 'B' }).expect(403);
    });
  });

  describe('seats', () => {
    it('refuses the invitation that would take the workspace over, and counts pending ones', async () => {
      const owner = await signUp(app, { name: 'Seat Owner' });
      const workspace = await createWorkspace(owner.agent, 'Seats', 'seats-limit');
      setLimit(PLAN_LIMIT_ENV.seatsPerWorkspace, 2);

      // Owner is one seat; the first invitation takes the second.
      await owner.agent
        .post(`/workspaces/${workspace.id}/invitations`)
        .send({ email: uniqueEmail('first'), role: MemberRole.MEMBER })
        .expect(201);

      const refused = await owner.agent
        .post(`/workspaces/${workspace.id}/invitations`)
        .send({ email: uniqueEmail('second'), role: MemberRole.MEMBER })
        .expect(403);

      expect(refused.body).toMatchObject({
        error: PLAN_LIMIT_ERROR,
        planLimit: { code: PlanLimitCode.Seats, limit: 2, current: 2 },
      });
      await expect(
        prisma.workspaceInvitation.count({ where: { workspaceId: workspace.id } }),
      ).resolves.toBe(1);
    });

    it('frees the seat again when the pending invitation is revoked', async () => {
      const owner = await signUp(app, { name: 'Revoker' });
      const workspace = await createWorkspace(owner.agent, 'Seats', 'seats-revoke');
      setLimit(PLAN_LIMIT_ENV.seatsPerWorkspace, 2);

      const invitation = await owner.agent
        .post(`/workspaces/${workspace.id}/invitations`)
        .send({ email: uniqueEmail('leaving'), role: MemberRole.MEMBER })
        .expect(201);
      await owner.agent
        .post(`/workspaces/${workspace.id}/invitations`)
        .send({ email: uniqueEmail('blocked'), role: MemberRole.MEMBER })
        .expect(403);

      await owner.agent
        .delete(`/workspaces/${workspace.id}/invitations/${invitation.body.id as string}`)
        .expect(204);

      await owner.agent
        .post(`/workspaces/${workspace.id}/invitations`)
        .send({ email: uniqueEmail('welcome'), role: MemberRole.MEMBER })
        .expect(201);
    });

    it('lets the invitee accept the seat their invitation is already holding', async () => {
      const owner = await signUp(app, { name: 'Accept Owner' });
      const invitee = await signUp(app, { name: 'Invitee' });
      await confirmEmail(app, prisma, invitee);
      const workspace = await createWorkspace(owner.agent, 'Seats', 'seats-accept');
      setLimit(PLAN_LIMIT_ENV.seatsPerWorkspace, 2);

      const invitation = await owner.agent
        .post(`/workspaces/${workspace.id}/invitations`)
        .send({ email: invitee.email, role: MemberRole.MEMBER })
        .expect(201);

      await invitee.agent
        .post(`/workspaces/${workspace.id}/invitations/${invitation.body.id as string}/accept`)
        .expect(200);
    });

    it('refuses an acceptance once the ceiling has been lowered under the roster', async () => {
      const owner = await signUp(app, { name: 'Lowering Owner' });
      const invitee = await signUp(app, { name: 'Late Invitee' });
      await confirmEmail(app, prisma, invitee);
      const workspace = await createWorkspace(owner.agent, 'Seats', 'seats-lowered');

      const invitation = await owner.agent
        .post(`/workspaces/${workspace.id}/invitations`)
        .send({ email: invitee.email, role: MemberRole.MEMBER })
        .expect(201);

      // One member (the owner) and a ceiling of one: there is no room for the acceptance.
      setLimit(PLAN_LIMIT_ENV.seatsPerWorkspace, 1);

      const refused = await invitee.agent
        .post(`/workspaces/${workspace.id}/invitations/${invitation.body.id as string}/accept`)
        .expect(403);

      expect(refused.body).toMatchObject({
        error: PLAN_LIMIT_ERROR,
        planLimit: { code: PlanLimitCode.Seats, limit: 1, current: 1 },
      });
      await expect(
        prisma.workspaceMember.count({ where: { workspaceId: workspace.id } }),
      ).resolves.toBe(1);
    });
  });

  describe('workspaces per instance', () => {
    it('refuses the workspace over the ceiling, whoever is creating it', async () => {
      const first = await signUp(app, { name: 'First Owner' });
      const second = await signUp(app, { name: 'Second Owner' });
      await createWorkspace(first.agent, 'Only One', 'ws-limit');
      setLimit(PLAN_LIMIT_ENV.workspaces, 1);

      const refused = await second.agent
        .post('/workspaces')
        .send({ name: 'Mine', slug: buildUniqueSlug('ws-refused') })
        .expect(403);

      expect(refused.body).toMatchObject({
        error: PLAN_LIMIT_ERROR,
        planLimit: { code: PlanLimitCode.Workspaces, limit: 1, current: 1 },
      });
      await expect(prisma.workspace.count()).resolves.toBe(1);
    });
  });

  describe('accounts per instance', () => {
    it('refuses sign-up at the ceiling and leaves sign-in working', async () => {
      const existing = await signUp(app, { name: 'The Only Account' });
      setLimit(PLAN_LIMIT_ENV.users, 1);

      const refused = await request(app.getHttpServer())
        .post('/auth/sign-up/email')
        .send({ email: uniqueEmail('refused'), password: 'password-for-tests-1', name: 'Nope' })
        .expect(403);

      expect(refused.body).toMatchObject({
        statusCode: 403,
        error: PLAN_LIMIT_ERROR,
        planLimit: { code: PlanLimitCode.Users, limit: 1, current: 1 },
      });
      await expect(prisma.user.count()).resolves.toBe(1);

      await request(app.getHttpServer())
        .post('/auth/sign-in/email')
        .send({ email: existing.email, password: 'password-for-tests-1' })
        .expect(200);
    });
  });

  describe('the read surface', () => {
    it('publishes the instance ceilings on GET /config', async () => {
      const user = await signUp(app, { name: 'Config Reader' });
      setLimit(PLAN_LIMIT_ENV.seatsPerWorkspace, 10);
      setLimit(PLAN_LIMIT_ENV.workspaces, 50);

      const config = await user.agent.get('/config').expect(200);

      expect(config.body.planLimits).toEqual({
        seatsPerWorkspace: 10,
        boardsPerWorkspace: null,
        workspaces: 50,
        users: null,
        // The ADR 0027 quotas are members of the same object, at their own defaults.
        storageBytesPerWorkspace: expect.any(Number),
        storageBytesPerInstance: expect.any(Number),
      });
    });

    it('reports resolved ceilings and usage for one workspace, to any member', async () => {
      const owner = await signUp(app, { name: 'Plan Owner' });
      const member = await signUp(app, { name: 'Plan Member' });
      await confirmEmail(app, prisma, member);
      const workspace = await createWorkspace(owner.agent, 'Usage', 'plan-usage');
      setLimit(PLAN_LIMIT_ENV.seatsPerWorkspace, 10);
      setLimit(PLAN_LIMIT_ENV.boardsPerWorkspace, 4);

      const invitation = await owner.agent
        .post(`/workspaces/${workspace.id}/invitations`)
        .send({ email: member.email, role: MemberRole.MEMBER })
        .expect(201);
      await owner.agent.post(`/workspaces/${workspace.id}/boards`).send({ name: 'A' }).expect(201);

      const pending = await owner.agent.get(`/workspaces/${workspace.id}/plan`).expect(200);
      expect(pending.body).toEqual({
        limits: { seats: 10, boards: 4, storageBytes: expect.any(Number) },
        usage: { seats: 2, boards: 1, storageBytes: 0 },
      });

      await member.agent
        .post(`/workspaces/${workspace.id}/invitations/${invitation.body.id as string}/accept`)
        .expect(200);

      // Two seats before and two seats after: the invitation was already holding one of them.
      const accepted = await member.agent.get(`/workspaces/${workspace.id}/plan`).expect(200);
      expect(accepted.body.usage.seats).toBe(2);
    });

    it('is scoped like every other workspace read', async () => {
      const owner = await signUp(app, { name: 'Plan Owner' });
      const stranger = await signUp(app, { name: 'Stranger' });
      const workspace = await createWorkspace(owner.agent, 'Private', 'plan-scope');

      await stranger.agent.get(`/workspaces/${workspace.id}/plan`).expect(404);
    });
  });
});

/** Every board seeds the same default columns, so a board count implies a column count. */
/** A small, valid Trello export; what it holds is `trello-import.e2e-spec.ts`'s business. */
const TRELLO_FIXTURE = join(__dirname, 'fixtures', 'trello', 'synthetic-full-board.json');

function defaultColumnCountOf(boards: number): number {
  return boards * 3;
}
