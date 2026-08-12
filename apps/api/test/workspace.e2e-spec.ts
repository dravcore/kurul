import { INestApplication } from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { addMember, confirmEmail, createWorkspace, setMemberRole, signUp } from './helpers/auth';
import { resetDatabase } from './helpers/db';

describe('Workspace isolation and roles (e2e)', () => {
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

  it('returns 404 for cross-tenant workspace access', async () => {
    const ownerA = await signUp(app, { name: 'Owner A' });
    const ownerB = await signUp(app, { name: 'Owner B' });
    const workspaceA = await createWorkspace(ownerA.agent, 'A', `a-${Date.now()}`);
    const workspaceB = await createWorkspace(ownerB.agent, 'B', `b-${Date.now()}`);

    await ownerA.agent.get(`/workspaces/${workspaceB.id}`).expect(404);
    await ownerB.agent.get(`/workspaces/${workspaceA.id}/members`).expect(404);
  });

  it('enforces the Phase 2 role matrix', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const admin = await signUp(app, { name: 'Admin' });
    const member = await signUp(app, { name: 'Member' });
    const guest = await signUp(app, { name: 'Guest' });

    const workspace = await createWorkspace(owner.agent, 'Matrix', `matrix-${Date.now()}`);

    const adminMe = await admin.agent.get('/me').expect(200);
    const memberMe = await member.agent.get('/me').expect(200);
    const guestMe = await guest.agent.get('/me').expect(200);

    await addMember(prisma, workspace.id, adminMe.body.id as string, MemberRole.ADMIN);
    await addMember(prisma, workspace.id, memberMe.body.id as string, MemberRole.MEMBER);
    await addMember(prisma, workspace.id, guestMe.body.id as string, MemberRole.GUEST);

    // OWNER — allow delete is tested separately; allow invite + deny nothing critical here.
    await owner.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email: 'invitee-owner@test.kurultay.dev', role: MemberRole.MEMBER })
      .expect(201);

    // ADMIN — allow update, deny delete
    await admin.agent
      .patch(`/workspaces/${workspace.id}`)
      .send({ name: 'Matrix Updated' })
      .expect(200);
    await admin.agent.delete(`/workspaces/${workspace.id}`).expect(403);

    // MEMBER — allow list members, deny invite
    await member.agent.get(`/workspaces/${workspace.id}/members`).expect(200);
    await member.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email: 'invitee-member@test.kurultay.dev', role: MemberRole.GUEST })
      .expect(403);

    // GUEST — allow get workspace, deny invite
    await guest.agent.get(`/workspaces/${workspace.id}`).expect(200);
    await guest.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email: 'invitee-guest@test.kurultay.dev', role: MemberRole.GUEST })
      .expect(403);

    // OWNER can still delete
    await owner.agent.delete(`/workspaces/${workspace.id}`).expect(204);
  });

  /**
   * The member list is a cursor page, not a plain array with a hidden ceiling: a page that
   * does not hold the whole roster has to say so and hand back a cursor that reaches the rest.
   */
  it('pages the member list by id and reaches every member', async () => {
    const owner = await signUp(app, { name: 'Roster Owner' });
    const workspace = await createWorkspace(owner.agent, 'Roster', `roster-${Date.now()}`);

    for (const name of ['Second', 'Third']) {
      const extra = await signUp(app, { name });
      const extraMe = await extra.agent.get('/me').expect(200);
      await addMember(prisma, workspace.id, extraMe.body.id as string, MemberRole.MEMBER);
    }

    const first = await owner.agent.get(`/workspaces/${workspace.id}/members?limit=2`).expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.nextCursor).toBe(first.body.items[1].id);

    const second = await owner.agent
      .get(`/workspaces/${workspace.id}/members?limit=2&cursor=${first.body.nextCursor as string}`)
      .expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.hasMore).toBe(false);
    expect(second.body.nextCursor).toBeNull();

    const ids = [...first.body.items, ...second.body.items].map(
      (member: { id: string }) => member.id,
    );
    expect(new Set(ids).size).toBe(3);
  });

  it("answers the caller's own membership without the roster", async () => {
    const owner = await signUp(app, { name: 'Self' });
    const outsider = await signUp(app, { name: 'Outsider' });
    const workspace = await createWorkspace(owner.agent, 'Self WS', `self-${Date.now()}`);
    const me = await owner.agent.get('/me').expect(200);

    await owner.agent
      .get(`/workspaces/${workspace.id}/members/me`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.userId).toBe(me.body.id);
        expect(body.role).toBe(MemberRole.OWNER);
        expect(body.workspaceId).toBe(workspace.id);
      });

    // Cross-tenant stays 404, same as the list route.
    await outsider.agent.get(`/workspaces/${workspace.id}/members/me`).expect(404);
  });

  it('grants the invited role on accept and blocks revoked invitations', async () => {
    const owner = await signUp(app, { name: 'Inviter' });
    const invitee = await signUp(app, {
      email: `invitee-${Date.now()}@test.kurultay.dev`,
      name: 'Invitee',
    });
    await confirmEmail(app, prisma, invitee);
    const workspace = await createWorkspace(owner.agent, 'Invite WS', `invite-${Date.now()}`);

    const createInvite = await owner.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email: invitee.email, role: MemberRole.GUEST })
      .expect(201);

    const invitationId = createInvite.body.id as string;

    await invitee.agent
      .post(`/workspaces/${workspace.id}/invitations/${invitationId}/accept`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.role).toBe(MemberRole.GUEST);
        expect(body.workspaceId).toBe(workspace.id);
      });

    const members = await owner.agent.get(`/workspaces/${workspace.id}/members`).expect(200);
    expect(members.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: MemberRole.GUEST,
        }),
      ]),
    );
    expect(members.body.hasMore).toBe(false);
    expect(members.body.nextCursor).toBeNull();

    // Second invite + revoke
    const other = await signUp(app, {
      email: `revoked-${Date.now()}@test.kurultay.dev`,
      name: 'Revoked',
    });
    const second = await owner.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email: other.email, role: MemberRole.MEMBER })
      .expect(201);

    await owner.agent
      .delete(`/workspaces/${workspace.id}/invitations/${second.body.id as string}`)
      .expect(204);

    await other.agent
      .post(`/workspaces/${workspace.id}/invitations/${second.body.id as string}/accept`)
      .expect((res) => {
        expect([400, 404]).toContain(res.status);
      });
  });

  /**
   * GHSA-fmh4-wcc4-5jm3. The account below holds the invited address without having proved
   * it owns it — exactly what an attacker does by registering on an invited address before
   * its real owner gets there. It must not be able to join the workspace.
   */
  it('refuses to accept an invitation from an unconfirmed email address', async () => {
    const owner = await signUp(app, { name: 'Inviter' });
    const squatter = await signUp(app, {
      email: `unconfirmed-${Date.now()}@test.kurultay.dev`,
      name: 'Unconfirmed',
    });
    const workspace = await createWorkspace(owner.agent, 'Guarded WS', `guarded-${Date.now()}`);

    const invite = await owner.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email: squatter.email, role: MemberRole.MEMBER })
      .expect(201);

    const invitationId = invite.body.id as string;

    await squatter.agent
      .post(`/workspaces/${workspace.id}/invitations/${invitationId}/accept`)
      .expect(403);

    const members = await owner.agent.get(`/workspaces/${workspace.id}/members`).expect(200);
    expect(members.body.items).toHaveLength(1);

    // …and the same request succeeds once the address is confirmed, so the 403 above is the
    // verification gate and not some unrelated failure.
    await confirmEmail(app, prisma, squatter);

    await squatter.agent
      .post(`/workspaces/${workspace.id}/invitations/${invitationId}/accept`)
      .expect(200);
  });

  it('resends the same invitation when the role is unchanged', async () => {
    const owner = await signUp(app, { name: 'Inviter' });
    const workspace = await createWorkspace(owner.agent, 'Resend WS', `resend-${Date.now()}`);
    const email = `resend-${Date.now()}@test.kurultay.dev`;

    const first = await owner.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email, role: MemberRole.MEMBER })
      .expect(201);

    const second = await owner.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email, role: MemberRole.MEMBER })
      .expect(201);

    expect(second.body.id).toBe(first.body.id as string);
    expect(second.body.role).toBe(MemberRole.MEMBER);

    const rows = await prisma.workspaceInvitation.findMany({
      where: { workspaceId: workspace.id, email },
    });
    expect(rows).toHaveLength(1);
  });

  it('revokes and reissues when the same email is re-invited at a different role', async () => {
    const owner = await signUp(app, { name: 'Inviter' });
    const workspace = await createWorkspace(owner.agent, 'Reinvite WS', `reinvite-${Date.now()}`);
    const email = `reinvite-${Date.now()}@test.kurultay.dev`;

    const asGuest = await owner.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email, role: MemberRole.GUEST })
      .expect(201);

    const asAdmin = await owner.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email, role: MemberRole.ADMIN })
      .expect(201);

    // The admin's intent wins: a new invitation, at the requested role, with an accept URL
    // pointing at it — not a silent resend of the GUEST one.
    expect(asAdmin.body.role).toBe(MemberRole.ADMIN);
    expect(asAdmin.body.id).not.toBe(asGuest.body.id as string);
    expect(asAdmin.body.acceptUrl).toContain(asAdmin.body.id as string);

    const superseded = await prisma.workspaceInvitation.findUnique({
      where: { id: asGuest.body.id as string },
    });
    expect(superseded?.status).not.toBe('pending');

    const pending = await prisma.workspaceInvitation.findMany({
      where: { workspaceId: workspace.id, email, status: 'pending' },
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.role).toBe(MemberRole.ADMIN);
  });

  it('rejects an OWNER invitation', async () => {
    const owner = await signUp(app, { name: 'Inviter' });
    const workspace = await createWorkspace(owner.agent, 'Owner WS', `owner-${Date.now()}`);

    await owner.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email: `owner-invite-${Date.now()}@test.kurultay.dev`, role: MemberRole.OWNER })
      .expect(400);
  });

  it('demotes OWNER only through explicit role writes in setup (ADMIN cannot delete)', async () => {
    const owner = await signUp(app);
    const workspace = await createWorkspace(owner.agent, 'Solo', `solo-${Date.now()}`);
    const me = await owner.agent.get('/me').expect(200);

    await setMemberRole(prisma, workspace.id, me.body.id as string, MemberRole.ADMIN);

    await owner.agent.delete(`/workspaces/${workspace.id}`).expect(403);
  });

  it('blocks Better Auth organization mutation HTTP so Nest remains the public API', async () => {
    const owner = await signUp(app, { name: 'BA Firewall' });

    await owner.agent
      .post('/auth/organization/create')
      .send({ name: 'Bypass', slug: `bypass-${Date.now()}` })
      .expect(403);

    const workspace = await createWorkspace(owner.agent, 'Nest WS', `nest-ws-${Date.now()}`);

    await owner.agent
      .post('/auth/organization/invite-member')
      .send({
        email: `ba-invite-${Date.now()}@test.kurultay.dev`,
        role: MemberRole.MEMBER,
        organizationId: workspace.id,
      })
      .expect(403);

    // Session UX path remains open.
    await owner.agent
      .post('/auth/organization/set-active')
      .send({ organizationId: workspace.id })
      .expect(200);
  });
});
