import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MailDeliveryStatus, MemberRole } from '@kurultay/shared-types';
import { createTestApp } from './helpers/app';
import { createWorkspace, signUp, type TestUser } from './helpers/auth';

/**
 * `GET /config` — the instance capability document (audit PM-04).
 *
 * The suite runs with whatever mail configuration the environment happens to carry: CI leaves
 * `SMTP_HOST` unset, a developer running against `docker-compose.dev.yml` points it at
 * Mailpit. So the assertions are about the *contract* — the document exists, it is a boolean,
 * it needs a session, and it agrees with what the invitation endpoint reports about the same
 * process — rather than about which value this particular run produces. Asserting `false`
 * here would fail on exactly the machine where mail works.
 */
describe('Instance config (e2e)', () => {
  let app: INestApplication<App>;
  let owner: TestUser;
  let workspaceId: string;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await signUp(app);
    workspaceId = (await createWorkspace(owner.agent, 'Config workspace')).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers a signed-in caller with a mailEnabled boolean', async () => {
    const response = await owner.agent.get('/config').expect(200);

    expect(typeof response.body.mailEnabled).toBe('boolean');
  });

  /**
   * The deliberate difference from `/health`, which is `@Public()` and `@SkipRateLimit()`.
   * Deployment configuration is not probe output, and the only client that needs it is behind
   * sign-in — see the reasoning on `InstanceConfigController`.
   */
  it('refuses a caller with no session', async () => {
    await request(app.getHttpServer()).get('/config').expect(401);
  });

  it('is readable by every member, not just an admin', async () => {
    const member = await signUp(app);
    await owner.agent
      .post(`/workspaces/${workspaceId}/invitations`)
      .send({ email: member.email, role: MemberRole.MEMBER })
      .expect(201);

    // No workspace scope on this route at all: it describes the server, not a tenant.
    await member.agent.get('/config').expect(200);
  });

  /**
   * The two surfaces of the same fact must never disagree — that disagreement *is* the finding
   * (a UI claiming mail works while the transport writes to a log file). Both derive from the
   * transport `createMailSender` chose, so this pins them together end to end, whichever way
   * the environment running the suite is configured.
   */
  it('agrees with the delivery status the invitation endpoint reports', async () => {
    const config = await owner.agent.get('/config').expect(200);
    const invitee = await signUp(app);

    const invitation = await owner.agent
      .post(`/workspaces/${workspaceId}/invitations`)
      .send({ email: invitee.email, role: MemberRole.MEMBER })
      .expect(201);

    // Observed, always: the plugin hook runs inside the request that creates the invitation.
    expect(Object.values(MailDeliveryStatus)).toContain(invitation.body.emailDelivery);

    if (config.body.mailEnabled) {
      expect(invitation.body.emailDelivery).not.toBe(MailDeliveryStatus.NOT_CONFIGURED);
    } else {
      expect(invitation.body.emailDelivery).toBe(MailDeliveryStatus.NOT_CONFIGURED);
    }
  });

  /**
   * The success metric behind the finding is "silent log-only invitation = 0": the create
   * response has to say what became of the email, whatever that was.
   */
  it('never leaves a created invitation silent about its email', async () => {
    const invitee = await signUp(app);

    const response = await owner.agent
      .post(`/workspaces/${workspaceId}/invitations`)
      .send({ email: invitee.email, role: MemberRole.GUEST })
      .expect(201);

    expect(response.body.emailDelivery).toBeDefined();
  });

  /**
   * A listed invitation is a stored row and delivery is not stored, so the list must not
   * report one — absence is the contract, and inventing `SENT` there would be the same lie in
   * a different place.
   */
  it('omits the delivery status from listed invitations', async () => {
    const response = await owner.agent.get(`/workspaces/${workspaceId}/invitations`).expect(200);

    expect(response.body.items.length).toBeGreaterThan(0);
    for (const item of response.body.items) {
      expect(item).not.toHaveProperty('emailDelivery');
    }
  });
});
