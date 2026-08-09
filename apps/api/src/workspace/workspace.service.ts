import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import type {
  InvitationDto,
  WorkspaceDto,
  WorkspaceMemberDto,
} from '@kurultay/shared-types';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { auth } from '../auth/auth';
import { betterAuthErrorCode, rethrowBetterAuthError } from '../auth/better-auth-error';
import { PrismaService } from '../prisma/prisma.service';
import { envString } from '../common/env';
import type { CreateInvitationDto } from './dto/create-invitation.dto';
import type { CreateWorkspaceDto } from './dto/create-workspace.dto';
import type { UpdateWorkspaceDto } from './dto/update-workspace.dto';

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  private headersFrom(request: Request): Headers {
    return fromNodeHeaders(request.headers);
  }

  private toWorkspaceDto(row: {
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
  }): WorkspaceDto {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listForUser(userId: string): Promise<WorkspaceDto[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => this.toWorkspaceDto(m.workspace));
  }

  async create(_userId: string, dto: CreateWorkspaceDto, request: Request): Promise<WorkspaceDto> {
    const existing = await this.prisma.workspace.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException('Workspace slug already taken');
    }

    try {
      const created = await auth.api.createOrganization({
        body: {
          name: dto.name,
          slug: dto.slug,
          keepCurrentActiveOrganization: false,
        },
        headers: this.headersFrom(request),
      });

      if (!created) {
        throw new BadRequestException('Failed to create workspace');
      }

      return this.toWorkspaceDto({
        id: created.id,
        name: created.name,
        slug: created.slug,
        createdAt: new Date(created.createdAt),
      });
    } catch (error) {
      // The Prisma pre-check above catches the ordinary case; this covers the race where
      // the slug is taken between that read and the write. Better Auth reports it as a
      // `400`, but `docs/api-conventions.md` makes a uniqueness violation a `409`.
      if (betterAuthErrorCode(error) === 'ORGANIZATION_ALREADY_EXISTS') {
        throw new ConflictException('Workspace slug already taken');
      }
      rethrowBetterAuthError(error, 'Failed to create workspace');
    }
  }

  async getById(workspaceId: string): Promise<WorkspaceDto> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    return this.toWorkspaceDto(workspace);
  }

  async update(
    workspaceId: string,
    dto: UpdateWorkspaceDto,
    request: Request,
  ): Promise<WorkspaceDto> {
    if (dto.slug !== undefined) {
      const clash = await this.prisma.workspace.findFirst({
        where: { slug: dto.slug, NOT: { id: workspaceId } },
      });
      if (clash) {
        throw new ConflictException('Workspace slug already taken');
      }
    }

    try {
      const updated = await auth.api.updateOrganization({
        body: {
          organizationId: workspaceId,
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
          },
        },
        headers: this.headersFrom(request),
      });

      if (!updated) {
        throw new NotFoundException('Workspace not found');
      }

      return this.toWorkspaceDto({
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        createdAt: new Date(updated.createdAt),
      });
    } catch (error) {
      if (betterAuthErrorCode(error) === 'ORGANIZATION_ALREADY_EXISTS') {
        throw new ConflictException('Workspace slug already taken');
      }
      rethrowBetterAuthError(error, 'Failed to update workspace', {
        404: 'Workspace not found',
      });
    }
  }

  async remove(workspaceId: string, request: Request): Promise<void> {
    try {
      await auth.api.deleteOrganization({
        body: { organizationId: workspaceId },
        headers: this.headersFrom(request),
      });
    } catch (error) {
      rethrowBetterAuthError(error, 'Failed to delete workspace', {
        404: 'Workspace not found',
      });
    }
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMemberDto[]> {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });

    return members.map((m) => ({
      id: m.id,
      workspaceId: m.workspaceId,
      userId: m.userId,
      role: m.role as MemberRole,
    }));
  }

  /**
   * Pending, unexpired invitations for an email in a workspace.
   *
   * Mirrors the organization plugin's own lookup exactly — same lower-cased email, same
   * `pending` status, same expiry filter — so the decision made in `createInvitation` is
   * taken over the same rows the plugin would act on.
   */
  private async findPendingInvitations(
    workspaceId: string,
    email: string,
  ): Promise<{ id: string; role: string | null }[]> {
    return this.prisma.workspaceInvitation.findMany({
      where: {
        workspaceId,
        email,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      select: { id: true, role: true },
    });
  }

  /**
   * Invites an email to the workspace, or re-issues the pending invitation it already has.
   *
   * `resend: true` tells the organization plugin to return the existing pending invitation
   * with a refreshed expiry instead of creating a second one — but it returns it *unchanged
   * otherwise*, including its role. Re-inviting someone at a different role would therefore
   * report success while quietly keeping the old role. So the two cases are separated here:
   *
   * - **Same role** — resend, which is exactly what the admin asked for.
   * - **Different role** — revoke the pending invitation first, so the plugin issues a fresh
   *   one at the requested role and the response (id, `acceptUrl`, role) describes it.
   */
  async createInvitation(
    workspaceId: string,
    dto: CreateInvitationDto,
    request: Request,
  ): Promise<InvitationDto> {
    if (dto.role === MemberRole.OWNER) {
      throw new BadRequestException('Cannot invite someone as OWNER');
    }

    const headers = this.headersFrom(request);
    // Better Auth stores and matches invitation emails lower-cased.
    const email = dto.email.toLowerCase();

    const pending = await this.findPendingInvitations(workspaceId, email);
    if (pending.some((invitation) => invitation.role !== dto.role)) {
      for (const invitation of pending) {
        try {
          await auth.api.cancelInvitation({
            body: { invitationId: invitation.id },
            headers,
          });
        } catch (error) {
          rethrowBetterAuthError(error, 'Failed to replace the pending invitation');
        }
      }
    }

    try {
      const invitation = await auth.api.createInvitation({
        body: {
          email,
          role: dto.role,
          organizationId: workspaceId,
          resend: true,
        },
        headers,
      });

      if (!invitation?.id || !invitation.email || !invitation.status || !invitation.expiresAt) {
        throw new BadRequestException('Failed to create invitation');
      }

      // Closes the remaining race: if another admin created a pending invitation between
      // the lookup above and this call, `resend: true` returned *theirs*, at their role.
      // Reporting that as the requested role is the exact silent loss this method prevents.
      const grantedRole = invitation.role as MemberRole | undefined;
      if (grantedRole !== undefined && grantedRole !== dto.role) {
        throw new ConflictException('Invitation was changed concurrently, please try again');
      }

      const webUrl = envString('WEB_URL', 'http://localhost:3000');
      return {
        id: invitation.id,
        workspaceId,
        email: invitation.email,
        role: dto.role,
        status: invitation.status,
        expiresAt: new Date(invitation.expiresAt).toISOString(),
        acceptUrl: `${webUrl}/invite/${invitation.id}`,
      };
    } catch (error) {
      // Deliberately generic: the plugin distinguishes "already a member" from "already
      // invited" from "no such user", and passing that through would turn this endpoint
      // into an email-enumeration oracle.
      rethrowBetterAuthError(error, 'Failed to create invitation', {
        403: 'You are not allowed to send this invitation',
      });
    }
  }

  async revokeInvitation(
    workspaceId: string,
    invitationId: string,
    request: Request,
  ): Promise<void> {
    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: { id: invitationId, workspaceId },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    try {
      await auth.api.cancelInvitation({
        body: { invitationId },
        headers: this.headersFrom(request),
      });
    } catch (error) {
      rethrowBetterAuthError(error, 'Failed to revoke invitation', {
        404: 'Invitation not found',
      });
    }
  }

  async acceptInvitation(
    workspaceId: string,
    invitationId: string,
    request: Request,
  ): Promise<WorkspaceMemberDto> {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation || invitation.status !== 'pending' || invitation.workspaceId !== workspaceId) {
      throw new NotFoundException('Invitation not found');
    }

    try {
      const result = await auth.api.acceptInvitation({
        body: { invitationId },
        headers: this.headersFrom(request),
      });

      const member = result?.member;
      if (!member) {
        throw new BadRequestException('Failed to accept invitation');
      }

      const memberWorkspaceId =
        'organizationId' in member && typeof member.organizationId === 'string'
          ? member.organizationId
          : workspaceId;

      return {
        id: member.id,
        workspaceId: memberWorkspaceId,
        userId: member.userId,
        role: member.role as MemberRole,
      };
    } catch (error) {
      rethrowBetterAuthError(error, 'Failed to accept invitation', {
        404: 'Invitation not found',
      });
    }
  }
}
