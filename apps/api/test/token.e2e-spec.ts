import { INestApplication } from '@nestjs/common';
import { ActivityType, MemberRole } from '@kurul/shared-types';
import request from 'supertest';
import { App } from 'supertest/types';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashToken, PERSONAL_ACCESS_TOKEN_PREFIX } from '../src/token/personal-access-token';
import { createTestApp } from './helpers/app';
import { addMember, createWorkspace, signUp, type TestUser } from './helpers/auth';
import { resetDatabase } from './helpers/db';

/**
 * The acceptance line for the first API 1.0 slice (ROADMAP, "API 1.0"): a workspace-scoped,
 * hashed-at-rest, owner-listable and revocable token can call the documented endpoints with
 * no cookie at all. Every request below that carries a token is made from a fresh supertest
 * `request(...)`, never from the signed-in agent, so a cookie cannot be what authenticated it.
 */
describe('Personal access tokens (e2e)', () => {
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

  async function userIdOf(user: TestUser): Promise<string> {
    const response = await user.agent.get('/me').expect(200);
    return response.body.id as string;
  }

  async function mint(
    user: TestUser,
    workspaceId: string,
    body: Record<string, unknown> = { name: 'CI runner' },
  ): Promise<{ id: string; token: string; prefix: string }> {
    const response = await user.agent.post(`/workspaces/${workspaceId}/tokens`).send(body);
    if (response.status !== 201) {
      throw new Error(`mint failed (${response.status}): ${JSON.stringify(response.body)}`);
    }
    return response.body as { id: string; token: string; prefix: string };
  }

  /** A request with no cookie jar: the only credential it can carry is the header. */
  function bearer(token: string) {
    return {
      get: (path: string) =>
        request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`),
      post: (path: string) =>
        request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`),
      delete: (path: string) =>
        request(app.getHttpServer()).delete(path).set('Authorization', `Bearer ${token}`),
    };
  }

  it('creates a token the owner sees once, stores only its hash, and lists it by prefix', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Tokens', 'tokens');

    const created = await owner.agent
      .post(`/workspaces/${workspace.id}/tokens`)
      .send({ name: 'CI runner' })
      .expect(201);

    expect(created.body.token).toMatch(new RegExp(`^${PERSONAL_ACCESS_TOKEN_PREFIX}`));
    expect(created.body.prefix).toBe((created.body.token as string).slice(0, 18));
    expect(created.body).toMatchObject({
      workspaceId: workspace.id,
      userId: await userIdOf(owner),
      name: 'CI runner',
      lastUsedAt: null,
      expiresAt: null,
    });

    const stored = await prisma.personalAccessToken.findUniqueOrThrow({
      where: { id: created.body.id as string },
    });
    expect(stored.tokenHash).toBe(hashToken(created.body.token as string));
    expect(JSON.stringify(stored)).not.toContain(created.body.token as string);

    const listed = await owner.agent.get(`/workspaces/${workspace.id}/tokens`).expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].id).toBe(created.body.id);
    expect(listed.body[0].prefix).toBe(created.body.prefix);
    expect(listed.body[0].token).toBeUndefined();

    const activity = await prisma.activity.findMany({
      where: { workspaceId: workspace.id, type: ActivityType.TokenCreated },
    });
    expect(activity).toHaveLength(1);
    expect(activity[0].payload).toMatchObject({
      tokenId: created.body.id,
      name: 'CI runner',
      prefix: created.body.prefix,
    });
    expect(JSON.stringify(activity[0].payload)).not.toContain(created.body.token as string);
  });

  it('authenticates a workspace request with the Bearer header alone and stamps lastUsedAt', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Tokens', 'tokens');
    const { id, token } = await mint(owner, workspace.id);

    // No cookie: the same path answers 401 without the header.
    await request(app.getHttpServer()).get(`/workspaces/${workspace.id}`).expect(401);

    const read = await bearer(token).get(`/workspaces/${workspace.id}`).expect(200);
    expect(read.body.id).toBe(workspace.id);

    const board = await bearer(token)
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'From a script' })
      .expect(201);
    await bearer(token)
      .get(`/workspaces/${workspace.id}/boards/${board.body.id as string}/columns`)
      .expect(200);

    const stored = await prisma.personalAccessToken.findUniqueOrThrow({ where: { id } });
    expect(stored.lastUsedAt).not.toBeNull();
  });

  it('acts with the role the owner holds right now, not the one at minting', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const guest = await signUp(app, { name: 'Guest' });
    const workspace = await createWorkspace(owner.agent, 'Tokens', 'tokens');
    const guestId = await userIdOf(guest);
    await addMember(prisma, workspace.id, guestId, MemberRole.GUEST);

    const { token } = await mint(guest, workspace.id);

    await bearer(token).get(`/workspaces/${workspace.id}/boards`).expect(200);
    await bearer(token)
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Refused for GUEST' })
      .expect(403);

    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: guestId } },
      data: { role: MemberRole.MEMBER },
    });

    await bearer(token)
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Allowed for MEMBER' })
      .expect(201);
  });

  it('answers 404 for another workspace, even one the owner is a member of', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const home = await createWorkspace(owner.agent, 'Home', 'home');
    const other = await createWorkspace(owner.agent, 'Other', 'other');
    const { token } = await mint(owner, home.id);

    await owner.agent.get(`/workspaces/${other.id}`).expect(200);
    await bearer(token).get(`/workspaces/${other.id}`).expect(404);
    await bearer(token).get(`/workspaces/${other.id}/boards`).expect(404);
    await bearer(token).get(`/workspaces/${uuidv7()}`).expect(404);
  });

  it('answers 403 on routes with no workspace in the path, and on token management', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Tokens', 'tokens');
    const { id, token } = await mint(owner, workspace.id);

    await bearer(token).get('/me').expect(403);
    await bearer(token).get('/workspaces').expect(403);
    await bearer(token).post('/workspaces').send({ name: 'X', slug: 'x-from-token' }).expect(403);

    await bearer(token).get(`/workspaces/${workspace.id}/tokens`).expect(403);
    await bearer(token)
      .post(`/workspaces/${workspace.id}/tokens`)
      .send({ name: 'minted by a token' })
      .expect(403);
    await bearer(token).delete(`/workspaces/${workspace.id}/tokens/${id}`).expect(403);

    // Nothing above minted or revoked anything.
    expect(await prisma.personalAccessToken.count()).toBe(1);
    expect(await prisma.personalAccessToken.count({ where: { revokedAt: null } })).toBe(1);
  });

  /**
   * The writes Better Auth's organization plugin performs on the caller's own session. A token
   * carries no session, so these answer a clear 403 up front rather than the plugin's 401, and
   * the reads beside them keep working.
   */
  it('answers 403 on the workspace-administration writes Better Auth performs, and 200 on the reads', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Tokens', 'tokens');
    const { token } = await mint(owner, workspace.id);

    await bearer(token).get(`/workspaces/${workspace.id}/members`).expect(200);
    await bearer(token).get(`/workspaces/${workspace.id}/invitations`).expect(200);

    await bearer(token)
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email: 'invitee@test.example.com', role: MemberRole.MEMBER })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/workspaces/${workspace.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed by a token' })
      .expect(403);
    await bearer(token).delete(`/workspaces/${workspace.id}`).expect(403);
    await bearer(token).post(`/workspaces/${workspace.id}/members/me/leave`).expect(403);

    const unchanged = await owner.agent.get(`/workspaces/${workspace.id}`).expect(200);
    expect(unchanged.body.name).toBe('Tokens');
  });

  it('is refused outright for a Bearer credential that is not a Kurul token, cookie or not', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Tokens', 'tokens');

    await bearer('not-a-kurul-token').get(`/workspaces/${workspace.id}`).expect(401);
    await bearer(`${PERSONAL_ACCESS_TOKEN_PREFIX}doesnotexist`)
      .get(`/workspaces/${workspace.id}`)
      .expect(401);
    // The signed-in agent also sends the header: the header wins and the cookie is ignored.
    await owner.agent
      .get(`/workspaces/${workspace.id}`)
      .set('Authorization', `Bearer ${PERSONAL_ACCESS_TOKEN_PREFIX}doesnotexist`)
      .expect(401);
  });

  it('revokes immediately, leaves the list, and records the revocation', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Tokens', 'tokens');
    const { id, token, prefix } = await mint(owner, workspace.id);

    await bearer(token).get(`/workspaces/${workspace.id}`).expect(200);

    await owner.agent.delete(`/workspaces/${workspace.id}/tokens/${id}`).expect(204);

    await bearer(token).get(`/workspaces/${workspace.id}`).expect(401);
    const listed = await owner.agent.get(`/workspaces/${workspace.id}/tokens`).expect(200);
    expect(listed.body).toEqual([]);
    // Revoked is a state, not a delete: the row is evidence beside its activity entry.
    const stored = await prisma.personalAccessToken.findUniqueOrThrow({ where: { id } });
    expect(stored.revokedAt).not.toBeNull();

    // Revoking twice, or revoking a token that never existed, is the same 404.
    await owner.agent.delete(`/workspaces/${workspace.id}/tokens/${id}`).expect(404);
    await owner.agent.delete(`/workspaces/${workspace.id}/tokens/${uuidv7()}`).expect(404);

    const activity = await prisma.activity.findMany({
      where: { workspaceId: workspace.id, type: ActivityType.TokenRevoked },
    });
    expect(activity).toHaveLength(1);
    expect(activity[0].payload).toMatchObject({ tokenId: id, prefix });
  });

  it('lets only the owner see or revoke a token; another member gets 404', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const admin = await signUp(app, { name: 'Admin' });
    const workspace = await createWorkspace(owner.agent, 'Tokens', 'tokens');
    await addMember(prisma, workspace.id, await userIdOf(admin), MemberRole.ADMIN);
    const { id, token } = await mint(owner, workspace.id);

    const adminList = await admin.agent.get(`/workspaces/${workspace.id}/tokens`).expect(200);
    expect(adminList.body).toEqual([]);
    await admin.agent.delete(`/workspaces/${workspace.id}/tokens/${id}`).expect(404);

    await bearer(token).get(`/workspaces/${workspace.id}`).expect(200);
  });

  it('refuses an expired token, and a creation whose expiry has already passed', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Tokens', 'tokens');

    await owner.agent
      .post(`/workspaces/${workspace.id}/tokens`)
      .send({ name: 'born expired', expiresAt: '2020-01-01T00:00:00.000Z' })
      .expect(400);
    await owner.agent
      .post(`/workspaces/${workspace.id}/tokens`)
      .send({ name: 'bad date', expiresAt: 'tomorrow' })
      .expect(400);

    const soon = new Date(Date.now() + 60_000).toISOString();
    const { id, token } = await mint(owner, workspace.id, { name: 'short lived', expiresAt: soon });
    await bearer(token).get(`/workspaces/${workspace.id}`).expect(200);

    await prisma.personalAccessToken.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await bearer(token).get(`/workspaces/${workspace.id}`).expect(401);
  });

  it('revokes a member’s tokens when they are removed from the workspace', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const member = await signUp(app, { name: 'Member' });
    const workspace = await createWorkspace(owner.agent, 'Tokens', 'tokens');
    const memberId = await userIdOf(member);
    await addMember(prisma, workspace.id, memberId, MemberRole.MEMBER);
    const { token } = await mint(member, workspace.id);

    await bearer(token).get(`/workspaces/${workspace.id}`).expect(200);

    await owner.agent.delete(`/workspaces/${workspace.id}/members/${memberId}`).expect(204);
    await bearer(token).get(`/workspaces/${workspace.id}`).expect(401);

    // Re-adding the person does not resurrect the credential.
    await addMember(prisma, workspace.id, memberId, MemberRole.MEMBER);
    await bearer(token).get(`/workspaces/${workspace.id}`).expect(401);
  });

  it('validates the create body', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Tokens', 'tokens');

    await owner.agent.post(`/workspaces/${workspace.id}/tokens`).send({}).expect(400);
    await owner.agent.post(`/workspaces/${workspace.id}/tokens`).send({ name: '' }).expect(400);
    await owner.agent
      .post(`/workspaces/${workspace.id}/tokens`)
      .send({ name: 'x'.repeat(81) })
      .expect(400);
    await owner.agent
      .post(`/workspaces/${workspace.id}/tokens`)
      .send({ name: 'ok', scopes: ['read'] })
      .expect(400);
  });
});
