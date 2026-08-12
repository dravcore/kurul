import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MemberRole } from '@kurultay/shared-types';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface TestUser {
  email: string;
  password: string;
  name: string;
  agent: request.Agent;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.example.com`;
}

export async function signUp(
  app: INestApplication<App>,
  overrides?: Partial<{ email: string; password: string; name: string }>,
): Promise<TestUser> {
  const email = overrides?.email ?? uniqueEmail('user');
  const password = overrides?.password ?? 'password-for-tests-1';
  const name = overrides?.name ?? 'Test User';
  const agent = request.agent(app.getHttpServer());

  const response = await agent.post('/auth/sign-up/email').send({
    email,
    password,
    name,
  });

  if (response.status >= 400) {
    throw new Error(`sign-up failed (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return { email, password, name, agent };
}

export async function signIn(
  app: INestApplication<App>,
  email: string,
  password: string,
): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent.post('/auth/sign-in/email').send({ email, password });
  if (response.status >= 400) {
    throw new Error(`sign-in failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return agent;
}

/**
 * Marks a test user's address as confirmed and re-signs them in.
 *
 * Accepting an invitation requires a verified email
 * (`requireEmailVerificationOnInvitation` in `src/auth/organization-options.ts`), so every
 * e2e that walks the invite flow has to put its invitee in that state.
 *
 * Flipping the column is not enough on its own: the session cookie caches the user for five
 * minutes (`session.cookieCache`), so the agent would keep presenting `emailVerified: false`
 * from the cookie it already holds. Signing in again mints a cookie that agrees with the
 * database. The user's `agent` is replaced in place, so callers keep using `user.agent`.
 *
 * The real flow gets here by clicking the link in the verification email; this is the same
 * end state without an SMTP server in the test environment.
 */
export async function confirmEmail(
  app: INestApplication<App>,
  prisma: PrismaService,
  user: TestUser,
): Promise<void> {
  await prisma.user.update({
    where: { email: user.email },
    data: { emailVerified: true },
  });

  user.agent = await signIn(app, user.email, user.password);
}

export async function createWorkspace(
  agent: request.Agent,
  name = 'Workspace',
  slug?: string,
): Promise<{ id: string; name: string; slug: string }> {
  const response = await agent.post('/workspaces').send({
    name,
    slug: slug ?? `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  });
  if (response.status >= 400) {
    throw new Error(
      `create workspace failed (${response.status}): ${JSON.stringify(response.body)}`,
    );
  }
  return response.body as { id: string; name: string; slug: string };
}

/** Force a membership role for matrix tests (bypasses invite flow). */
export async function setMemberRole(
  prisma: PrismaService,
  workspaceId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  await prisma.workspaceMember.update({
    where: {
      workspaceId_userId: { workspaceId, userId },
    },
    data: { role },
  });
}

export async function addMember(
  prisma: PrismaService,
  workspaceId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  await prisma.workspaceMember.create({
    data: { workspaceId, userId, role },
  });
}
