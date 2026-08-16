import { INestApplication } from '@nestjs/common';
import {
  AUDIT_ACTIVITY_TYPES,
  ActivityType,
  ColumnCategory,
  LabelColorSlot,
  MemberRole,
} from '@kurul/shared-types';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { addMember, confirmEmail, createWorkspace, signUp, type TestUser } from './helpers/auth';
import { resetDatabase } from './helpers/db';

/**
 * The question this suite exists to answer is not "does each service call `record`?" — the unit
 * specs cover that against mocks. It is the one an operator asks after an account is
 * compromised: **who removed, granted or destroyed something in this workspace, and when?**
 *
 * So the tests drive the real HTTP surface for a full administrative session and then ask the
 * database that question in a single statement, exactly as an incident responder would. A gap
 * anywhere between the controller and the `Activity` row shows up as a missing type in the
 * result, which is the failure mode the audit finding (SEC-05) described.
 */
describe('Administrative audit trail (e2e)', () => {
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

  /**
   * The single query.
   *
   * `workspaceId` + `type IN (…)` + `id DESC` — one index-served statement over one table, with
   * the actor joined in. Nothing here filters in application code, because the point of the
   * exported `AUDIT_ACTIVITY_TYPES` list is that the predicate can go to the database.
   */
  async function auditTrail(workspaceId: string) {
    return prisma.activity.findMany({
      where: { workspaceId, type: { in: [...AUDIT_ACTIVITY_TYPES] } },
      include: { user: { select: { name: true } } },
      orderBy: { id: 'desc' },
    });
  }

  async function userIdOf(user: TestUser): Promise<string> {
    const response = await user.agent.get('/me').expect(200);
    return response.body.id as string;
  }

  it('answers "who changed access or destroyed something, and when" in one query', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const admin = await signUp(app, { name: 'Admin' });
    const leaver = await signUp(app, { name: 'Leaver' });
    const workspace = await createWorkspace(owner.agent, 'Audit', `audit-${Date.now()}`);
    const adminId = await userIdOf(admin);
    const leaverId = await userIdOf(leaver);
    await addMember(prisma, workspace.id, adminId, MemberRole.MEMBER);
    await addMember(prisma, workspace.id, leaverId, MemberRole.MEMBER);

    // --- board structure -------------------------------------------------------------
    const board = await owner.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Q3 Launch' })
      .expect(201);
    const boardId = board.body.id as string;

    await owner.agent
      .patch(`/workspaces/${workspace.id}/boards/${boardId}`)
      .send({ name: 'Q3 Launch (archived)' })
      .expect(200);

    const column = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/columns`)
      .send({ name: 'Blocked', category: ColumnCategory.STARTED })
      .expect(201);
    const columnId = column.body.id as string;

    await owner.agent
      .patch(`/workspaces/${workspace.id}/columns/${columnId}`)
      .send({ category: ColumnCategory.COMPLETED })
      .expect(200);
    await owner.agent.delete(`/workspaces/${workspace.id}/columns/${columnId}`).expect(204);

    const label = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/labels`)
      .send({ name: 'Security', color: LabelColorSlot['slot-1'] })
      .expect(201);
    const labelId = label.body.id as string;

    await owner.agent
      .patch(`/workspaces/${workspace.id}/labels/${labelId}`)
      .send({ name: 'Security review' })
      .expect(200);
    await owner.agent.delete(`/workspaces/${workspace.id}/labels/${labelId}`).expect(204);

    // A destroyed card — the one content event the trail keeps, because it is the one that
    // removes work rather than editing it.
    const columns = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${boardId}/columns`)
      .expect(200);
    const task = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/tasks`)
      .send({ title: 'Rotate credentials', columnId: columns.body[0].id })
      .expect(201);
    await owner.agent.delete(`/workspaces/${workspace.id}/tasks/${task.body.id}`).expect(204);

    // --- workspace administration ----------------------------------------------------
    await owner.agent
      .patch(`/workspaces/${workspace.id}`)
      .send({ name: 'Audit (renamed)' })
      .expect(200);

    const invitation = await owner.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email: 'contractor@test.example.com', role: MemberRole.GUEST })
      .expect(201);
    await owner.agent
      .delete(`/workspaces/${workspace.id}/invitations/${invitation.body.id as string}`)
      .expect(204);

    await owner.agent
      .patch(`/workspaces/${workspace.id}/members/${adminId}/role`)
      .send({ role: MemberRole.ADMIN })
      .expect(200);
    await leaver.agent.post(`/workspaces/${workspace.id}/members/me/leave`).expect(204);
    await owner.agent.delete(`/workspaces/${workspace.id}/members/${adminId}`).expect(204);

    // Last, because it cascades the board's own rows away — the audit entries survive it,
    // which is the property `board.deleted` depends on.
    await owner.agent.delete(`/workspaces/${workspace.id}/boards/${boardId}`).expect(204);

    // --- the single query ------------------------------------------------------------
    const trail = await auditTrail(workspace.id);
    const types = trail.map((row) => row.type);

    expect(new Set(types)).toEqual(
      new Set([
        ActivityType.BoardCreated,
        ActivityType.BoardUpdated,
        ActivityType.BoardDeleted,
        ActivityType.ColumnCreated,
        ActivityType.ColumnUpdated,
        ActivityType.ColumnDeleted,
        ActivityType.LabelCreated,
        ActivityType.LabelUpdated,
        ActivityType.LabelDeleted,
        ActivityType.TaskDeleted,
        ActivityType.WorkspaceUpdated,
        ActivityType.InvitationCreated,
        ActivityType.InvitationRevoked,
        ActivityType.MemberRoleChanged,
        ActivityType.MemberLeft,
        ActivityType.MemberRemoved,
      ]),
    );

    // Every row names an actor and a moment — the two halves of "who, and when".
    for (const row of trail) {
      expect(row.userId).toEqual(expect.any(String));
      expect(row.user.name).toEqual(expect.any(String));
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.workspaceId).toBe(workspace.id);
    }

    // The escalation and the revocation, read straight out of the same result set.
    const escalation = trail.find((row) => row.type === ActivityType.MemberRoleChanged);
    expect(escalation?.payload).toMatchObject({
      targetUserId: adminId,
      previousRole: MemberRole.MEMBER,
      newRole: MemberRole.ADMIN,
      actorRole: MemberRole.OWNER,
    });

    const revocation = trail.find((row) => row.type === ActivityType.MemberRemoved);
    expect(revocation?.payload).toMatchObject({
      targetUserId: adminId,
      // The role the removed account held at the moment it lost access — the membership row
      // is gone, so this payload is the only place that fact still exists.
      previousRole: MemberRole.ADMIN,
    });

    // A departure is not a revocation, and the trail says which is which.
    const departure = trail.find((row) => row.type === ActivityType.MemberLeft);
    expect(departure?.userId).toBe(leaverId);
    expect(departure?.payload).toMatchObject({ targetUserId: leaverId });

    // The board is gone; what it was called and how much work went with it is not.
    const boardDeletion = trail.find((row) => row.type === ActivityType.BoardDeleted);
    expect(boardDeletion?.payload).toMatchObject({ name: 'Q3 Launch (archived)', taskCount: 0 });
  });

  it('records an accepted invitation against the invitee, not the inviter', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const invitee = await signUp(app, { name: 'Invitee' });
    const workspace = await createWorkspace(owner.agent, 'Invites', `invites-${Date.now()}`);
    // Accepting requires a confirmed address (`requireEmailVerificationOnInvitation`).
    await confirmEmail(app, prisma, invitee);
    const inviteeId = await userIdOf(invitee);

    const invitation = await owner.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email: invitee.email, role: MemberRole.MEMBER })
      .expect(201);
    await invitee.agent
      .post(`/workspaces/${workspace.id}/invitations/${invitation.body.id as string}/accept`)
      .expect(200);

    const trail = await auditTrail(workspace.id);
    const created = trail.find((row) => row.type === ActivityType.InvitationCreated);
    const accepted = trail.find((row) => row.type === ActivityType.InvitationAccepted);

    // Two acts, days apart in production, and only the second one granted anything.
    expect(created?.userId).toBe(await userIdOf(owner));
    expect(accepted?.userId).toBe(inviteeId);
    expect(accepted?.payload).toMatchObject({ role: MemberRole.MEMBER });
  });

  /**
   * Driven over HTTP as the least-privileged reader, because the unit-level guard in
   * `workspace-invitation.service.spec.ts` can only prove what the service *writes*. This proves
   * what a GUEST can *read*, which is the thing that actually matters: the activities feed is
   * `@WorkspaceScoped()` and hands back `payload` verbatim, while the pending-invitation list is
   * `@WorkspaceRoles(...ADMIN_ROLES)`. If an invited address ever lands on an activity payload,
   * the audit trail has quietly reopened the door `listInvitations` closed.
   */
  it('does not leak invited addresses to a GUEST through the activities feed', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const guest = await signUp(app, { name: 'Guest' });
    const workspace = await createWorkspace(owner.agent, 'Leak', `leak-${Date.now()}`);
    await addMember(prisma, workspace.id, await userIdOf(guest), MemberRole.GUEST);

    const invitedAddress = `contractor-${Date.now()}@test.example.com`;
    const invitation = await owner.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email: invitedAddress, role: MemberRole.GUEST })
      .expect(201);
    await owner.agent
      .delete(`/workspaces/${workspace.id}/invitations/${invitation.body.id as string}`)
      .expect(204);

    // The gate the address is supposed to sit behind still holds…
    await guest.agent.get(`/workspaces/${workspace.id}/invitations`).expect(403);

    // …and the feed the GUEST *can* read does not carry it in any form.
    const feed = await guest.agent.get(`/workspaces/${workspace.id}/activities`).expect(200);
    expect(JSON.stringify(feed.body)).not.toContain(invitedAddress);

    // The id is on the row, so an admin still recovers the address by joining
    // `WorkspaceInvitation` — forensic value kept, exposure not widened.
    const trail = await auditTrail(workspace.id);
    for (const row of trail) {
      expect(row.payload).toMatchObject({ invitationId: invitation.body.id as string });
    }
    expect(trail).toHaveLength(2);
  });

  it('keeps one workspace’s trail out of another’s', async () => {
    const ownerA = await signUp(app, { name: 'Owner A' });
    const ownerB = await signUp(app, { name: 'Owner B' });
    const workspaceA = await createWorkspace(ownerA.agent, 'A', `audit-a-${Date.now()}`);
    const workspaceB = await createWorkspace(ownerB.agent, 'B', `audit-b-${Date.now()}`);

    await ownerA.agent
      .post(`/workspaces/${workspaceA.id}/boards`)
      .send({ name: 'Only in A' })
      .expect(201);

    // The predicate that makes the query tenant-safe is the same `workspaceId` every other
    // read carries; without it the audit view would be the one place the isolation rule leaks.
    await expect(auditTrail(workspaceB.id)).resolves.toEqual([]);
    const trailA = await auditTrail(workspaceA.id);
    expect(trailA).toHaveLength(1);
    expect(trailA[0]!.payload).toMatchObject({ name: 'Only in A' });
  });

  it('writes no entry for a refused administrative call', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const stranger = await signUp(app, { name: 'Stranger' });
    const workspace = await createWorkspace(owner.agent, 'Refusals', `refusals-${Date.now()}`);
    const strangerId = await userIdOf(stranger);
    await addMember(prisma, workspace.id, strangerId, MemberRole.MEMBER);

    // A MEMBER may not invite, and the last OWNER may not be demoted. Both are refused before
    // anything is written, and an audit trail that recorded attempts as changes would be worse
    // than one that missed them: it would report access that was never granted.
    await stranger.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email: 'nobody@test.example.com', role: MemberRole.GUEST })
      .expect(403);
    await owner.agent
      .patch(`/workspaces/${workspace.id}/members/${await userIdOf(owner)}/role`)
      .send({ role: MemberRole.MEMBER })
      .expect(409);

    await expect(auditTrail(workspace.id)).resolves.toEqual([]);
  });
});
